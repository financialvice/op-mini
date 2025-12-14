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
      } = body;

      const opts = {
        model,
        workingDirectory,
        reasoningLevel: reasoningLevel as ReasoningLevel | undefined,
        oauthToken,
        idToken,
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
      }),
    }
  )
  .post(
    "/sessions/:sessionId/continue",
    async function* ({ params, body }) {
      const { sessionId } = params;
      const { content, model, reasoningLevel, oauthToken, idToken } = body;

      const session = getSession(sessionId);
      if (!session) {
        yield formatSSE({
          type: "error",
          timestamp: Date.now(),
          message: `Session ${sessionId} not found`,
        });
        return;
      }

      const opts = {
        model,
        reasoningLevel: reasoningLevel as ReasoningLevel | undefined,
        oauthToken,
        idToken,
      };
      const generator =
        session.provider === "claude"
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
        content: ContentSchema,
        model: t.Optional(t.String()),
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
  .listen(PORT);

export type App = typeof app;

console.log(`Agents server running on http://localhost:${PORT}`);
