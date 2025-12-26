import { access, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import cors from "@elysiajs/cors";
import { Elysia, t } from "elysia";
import {
  continueClaudeSession,
  getClaudeSession,
  interruptClaudeSession,
  startClaudeSession,
} from "./claude-code";
import {
  continueCodexSession,
  getCodexSession,
  interruptCodexSession,
  startCodexSession,
} from "./codex";
import type { ReasoningLevel } from "./models";
import type { MessageContent, Provider, UnifiedEvent } from "./types";

const PORT = Number(process.env.PORT) || 3001;

function formatSSE(event: UnifiedEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function* streamEvents(
  generator: AsyncGenerator<UnifiedEvent>
): AsyncGenerator<string> {
  for await (const event of generator) {
    yield formatSSE(event);
  }
}

function getSession(sessionId: string): { provider: Provider } | undefined {
  return getClaudeSession(sessionId) ?? getCodexSession(sessionId);
}

const ContentSchema = t.Array(
  t.Union([
    t.Object({
      type: t.Literal("text"),
      text: t.String(),
    }),
    t.Object({
      type: t.Literal("image"),
      data: t.String(),
      mediaType: t.String(),
    }),
  ])
);

const app = new Elysia()
  .use(cors())
  .post(
    "/sessions",
    async function* ({ body }) {
      const {
        provider,
        content,
        model,
        workingDirectory,
        reasoningLevel,
        oauthToken,
        idToken,
        env,
      } = body;

      const opts = {
        model,
        workingDirectory,
        reasoningLevel: reasoningLevel as ReasoningLevel | undefined,
        oauthToken,
        idToken,
        env,
      };
      const generator =
        provider === "claude"
          ? startClaudeSession(content as MessageContent[], opts)
          : startCodexSession(content as MessageContent[], opts);

      for await (const chunk of streamEvents(generator)) {
        yield chunk;
      }
    },
    {
      body: t.Object({
        provider: t.Union([t.Literal("claude"), t.Literal("codex")]),
        content: ContentSchema,
        model: t.Optional(t.String()),
        workingDirectory: t.Optional(t.String()),
        reasoningLevel: t.Optional(
          t.Union([
            t.Literal(0),
            t.Literal(1),
            t.Literal(2),
            t.Literal(3),
            t.Literal(4),
          ])
        ),
        oauthToken: t.Optional(t.String()),
        idToken: t.Optional(t.String()),
        env: t.Optional(t.Record(t.String(), t.String())),
      }),
    }
  )
  .post(
    "/sessions/:sessionId/continue",
    async function* ({ params, body }) {
      const { sessionId } = params;
      const {
        provider,
        content,
        model,
        workingDirectory,
        reasoningLevel,
        oauthToken,
        idToken,
        env,
      } = body;

      // Try to get session from memory, fall back to provided provider
      const session = getSession(sessionId);
      const resolvedProvider = session?.provider ?? provider;

      if (!resolvedProvider) {
        yield formatSSE({
          type: "error",
          timestamp: Date.now(),
          message: `Session ${sessionId} not found and no provider specified`,
        });
        return;
      }

      const opts = {
        model,
        workingDirectory,
        reasoningLevel: reasoningLevel as ReasoningLevel | undefined,
        oauthToken,
        idToken,
        env,
      };
      const generator =
        resolvedProvider === "claude"
          ? continueClaudeSession(sessionId, content as MessageContent[], opts)
          : continueCodexSession(sessionId, content as MessageContent[], opts);

      for await (const chunk of streamEvents(generator)) {
        yield chunk;
      }
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
      body: t.Object({
        provider: t.Optional(
          t.Union([t.Literal("claude"), t.Literal("codex")])
        ),
        content: ContentSchema,
        model: t.Optional(t.String()),
        workingDirectory: t.Optional(t.String()),
        reasoningLevel: t.Optional(
          t.Union([
            t.Literal(0),
            t.Literal(1),
            t.Literal(2),
            t.Literal(3),
            t.Literal(4),
          ])
        ),
        oauthToken: t.Optional(t.String()),
        idToken: t.Optional(t.String()),
        env: t.Optional(t.Record(t.String(), t.String())),
      }),
    }
  )
  .post(
    "/sessions/:sessionId/interrupt",
    async ({ params }) => {
      const { sessionId } = params;

      const session = getSession(sessionId);
      if (!session) {
        return { success: false, error: `Session ${sessionId} not found` };
      }

      const success =
        session.provider === "claude"
          ? interruptClaudeSession(sessionId)
          : await interruptCodexSession(sessionId);

      return { success };
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
    }
  )
  // ─── Filesystem Routes ───────────────────────────────────────────────
  .get(
    "/fs/ls",
    async ({ query: { path, recursive } }) => {
      const entries = await readdir(path, {
        withFileTypes: true,
        recursive: recursive === "true",
      });
      return entries.map((e) => ({
        name: e.name,
        path: e.parentPath ? `${e.parentPath}/${e.name}` : `${path}/${e.name}`,
        isDir: e.isDirectory(),
      }));
    },
    {
      query: t.Object({
        path: t.String(),
        recursive: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/fs/read",
    async ({ query: { path } }) => {
      try {
        await access(path);
      } catch {
        throw new Error("File not found");
      }
      const content = await readFile(path, "utf-8");
      const s = await stat(path);
      return { content, size: s.size };
    },
    { query: t.Object({ path: t.String() }) }
  )
  .get(
    "/fs/stat",
    async ({ query: { path } }) => {
      const s = await stat(path);
      return {
        size: s.size,
        mtime: s.mtime.toISOString(),
        isDir: s.isDirectory(),
        isFile: s.isFile(),
      };
    },
    { query: t.Object({ path: t.String() }) }
  )
  .post(
    "/fs/read-batch",
    async ({ body: { paths } }) => {
      const results = await Promise.all(
        paths.map(async (p) => {
          try {
            await access(p);
            const content = await readFile(p, "utf-8");
            const s = await stat(p);
            return { path: p, content, size: s.size };
          } catch (err) {
            return { path: p, error: String(err) };
          }
        })
      );
      return results;
    },
    { body: t.Object({ paths: t.Array(t.String()) }) }
  )
  // ─── Claude Projects Routes ──────────────────────────────────────────
  .get("/fs/claude-projects", async () => {
    const projectsDir = join(homedir(), ".claude", "projects");
    try {
      const entries = await readdir(projectsDir, { withFileTypes: true });
      const projects = entries
        .filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, path: join(projectsDir, e.name) }));
      return { projects };
    } catch {
      return { projects: [], error: "Could not read projects directory" };
    }
  })
  .get(
    "/fs/claude-projects/:project/sessions",
    async ({ params: { project } }) => {
      const projectDir = join(homedir(), ".claude", "projects", project);
      try {
        const entries = await readdir(projectDir, { withFileTypes: true });
        const sessions = entries
          .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
          .map((e) => ({ name: e.name, path: join(projectDir, e.name) }));
        return { sessions };
      } catch {
        return { sessions: [], error: "Could not read project directory" };
      }
    },
    { params: t.Object({ project: t.String() }) }
  )
  .listen(PORT);

export type App = typeof app;

console.log(`Agents server running on http://localhost:${PORT}`);
