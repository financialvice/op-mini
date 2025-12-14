import { tasks } from "@trigger.dev/sdk";
import z from "zod";
import { t } from "../server";

export const sessionsRouter = t.router({
  send: t.procedure
    .input(
      z.object({
        sessionId: z.string(),
        messageId: z.string(),
        assistantMessageId: z.string(),
        userId: z.string(),
        isNewSession: z.boolean(),
        provider: z.enum(["claude", "codex"]),
        model: z.string(),
        reasoningLevel: z.number().int().min(0).max(4),
      })
    )
    .mutation(async ({ input }) => {
      const {
        sessionId,
        messageId,
        assistantMessageId,
        userId,
        isNewSession,
        provider,
        model,
        reasoningLevel,
      } = input;

      const taskId = isNewSession ? "create-session" : "continue-session";
      const handle = await tasks.trigger(taskId, {
        sessionId,
        messageId,
        assistantMessageId,
        userId,
        provider,
        model,
        reasoningLevel,
      });

      return { runId: handle.id };
    }),
});
