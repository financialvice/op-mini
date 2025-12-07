import * as acp from "@agentclientprotocol/sdk";
import cors from "@elysiajs/cors";
import { type FileSink, type Subprocess, spawn } from "bun";
import { Elysia, t } from "elysia";

// Elysia validators matching ACP ContentBlock types exactly
const Meta = t.Optional(t.Union([t.Record(t.String(), t.Unknown()), t.Null()]));
const Role = t.Union([t.Literal("assistant"), t.Literal("user")]);
const Annotations = t.Optional(
  t.Union([
    t.Object({
      _meta: Meta,
      audience: t.Optional(t.Union([t.Array(Role), t.Null()])),
      lastModified: t.Optional(t.Union([t.String(), t.Null()])),
      priority: t.Optional(t.Union([t.Number(), t.Null()])),
    }),
    t.Null(),
  ])
);

const TextContent = t.Object({
  type: t.Literal("text"),
  _meta: Meta,
  annotations: Annotations,
  text: t.String(),
});

const ImageContent = t.Object({
  type: t.Literal("image"),
  _meta: Meta,
  annotations: Annotations,
  data: t.String(),
  mimeType: t.String(),
  uri: t.Optional(t.Union([t.String(), t.Null()])),
});

const AudioContent = t.Object({
  type: t.Literal("audio"),
  _meta: Meta,
  annotations: Annotations,
  data: t.String(),
  mimeType: t.String(),
});

const ResourceLink = t.Object({
  type: t.Literal("resource_link"),
  _meta: Meta,
  annotations: Annotations,
  description: t.Optional(t.Union([t.String(), t.Null()])),
  mimeType: t.Optional(t.Union([t.String(), t.Null()])),
  name: t.String(),
  size: t.Optional(t.Union([t.BigInt(), t.Null()])),
  title: t.Optional(t.Union([t.String(), t.Null()])),
  uri: t.String(),
});

const TextResourceContents = t.Object({
  _meta: Meta,
  mimeType: t.Optional(t.Union([t.String(), t.Null()])),
  text: t.String(),
  uri: t.String(),
});

const BlobResourceContents = t.Object({
  _meta: Meta,
  blob: t.String(),
  mimeType: t.Optional(t.Union([t.String(), t.Null()])),
  uri: t.String(),
});

const EmbeddedResource = t.Object({
  type: t.Literal("resource"),
  _meta: Meta,
  annotations: Annotations,
  resource: t.Union([TextResourceContents, BlobResourceContents]),
});

const ContentBlock = t.Union([
  TextContent,
  ImageContent,
  AudioContent,
  ResourceLink,
  EmbeddedResource,
]);

// MCP Server validators
const EnvVariable = t.Object({
  _meta: Meta,
  name: t.String(),
  value: t.String(),
});

const HttpHeader = t.Object({
  _meta: Meta,
  name: t.String(),
  value: t.String(),
});

const McpServerStdio = t.Object({
  _meta: Meta,
  name: t.String(),
  command: t.String(),
  args: t.Array(t.String()),
  env: t.Array(EnvVariable),
});

const McpServerHttp = t.Object({
  type: t.Literal("http"),
  _meta: Meta,
  name: t.String(),
  url: t.String(),
  headers: t.Array(HttpHeader),
});

const McpServerSse = t.Object({
  type: t.Literal("sse"),
  _meta: Meta,
  name: t.String(),
  url: t.String(),
  headers: t.Array(HttpHeader),
});

const McpServer = t.Union([McpServerStdio, McpServerHttp, McpServerSse]);

interface Session {
  connection: acp.ClientSideConnection;
  process: Subprocess;
  sessionId: string;
  messages: acp.SessionNotification[];
}

const sessions = new Map<string, Session>();

const fileSinkToWritableStream = (sink: FileSink): WritableStream<Uint8Array> =>
  new WritableStream({
    write: (chunk) => {
      sink.write(chunk);
    },
    close: () => {
      sink.end();
    },
  });

const spawnAgent = (type: "claude" | "codex") => {
  const proc = spawn(
    ["bunx", type === "claude" ? "claude-code-acp" : "codex-acp"],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    }
  );
  if (!(proc.stdin && proc.stdout)) {
    throw new Error("Failed to spawn agent");
  }
  return { proc, stdin: proc.stdin, stdout: proc.stdout };
};

const app = new Elysia()
  .use(cors())
  .post(
    "/sessions",
    async ({ body }) => {
      const { proc, stdin, stdout } = spawnAgent(body.agent);
      const stream = acp.ndJsonStream(fileSinkToWritableStream(stdin), stdout);
      const messages: acp.SessionNotification[] = [];

      const connection = new acp.ClientSideConnection(
        () => ({
          requestPermission: (
            params
          ): Promise<acp.RequestPermissionResponse> => {
            console.log("Permission requested:", params.toolCall);
            const option =
              params.options.find((o) => o.kind.includes("allow")) ??
              params.options[0];
            return Promise.resolve(
              option
                ? {
                    outcome: { outcome: "selected", optionId: option.optionId },
                  }
                : { outcome: { outcome: "cancelled" } }
            );
          },
          sessionUpdate: (notification) => {
            messages.push(notification);
            return Promise.resolve();
          },
        }),
        stream
      );

      await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });

      const { sessionId, models, modes } = await connection.newSession({
        cwd: body.cwd ?? process.cwd(),
        mcpServers: body.mcpServers ?? [],
      });

      sessions.set(sessionId, {
        connection,
        process: proc,
        sessionId,
        messages,
      });
      return { sessionId, models, modes };
    },
    {
      body: t.Object({
        agent: t.Union([t.Literal("claude"), t.Literal("codex")]),
        cwd: t.Optional(t.String()),
        mcpServers: t.Optional(t.Array(McpServer)),
      }),
    }
  )
  .post(
    "/sessions/:id/prompt",
    async ({ params, body }) => {
      const session = sessions.get(params.id);
      if (!session) {
        throw new Error("Session not found");
      }

      session.messages.length = 0;
      await session.connection.prompt({
        sessionId: session.sessionId,
        prompt: body.prompt,
      });
      return { messages: session.messages };
    },
    { body: t.Object({ prompt: t.Array(ContentBlock) }) }
  )
  .delete("/sessions/:id", ({ params }) => {
    const session = sessions.get(params.id);
    if (session) {
      session.process.kill();
      sessions.delete(params.id);
    }
    return { ok: true };
  })
  .get("/sessions/:id", ({ params }) => {
    const session = sessions.get(params.id);
    if (!session) {
      throw new Error("Session not found");
    }
    return {
      sessionId: session.sessionId,
      messageCount: session.messages.length,
    };
  })
  .listen(3456);

console.log(`ACP Server running at http://localhost:${app.server?.port}`);
