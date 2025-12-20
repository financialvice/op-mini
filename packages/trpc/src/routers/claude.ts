import * as claudeSDK from "@anthropic-ai/claude-agent-sdk";
import { initLogger, wrapClaudeAgentSDK } from "braintrust";
import { z } from "zod";
import { t } from "../server";

initLogger({
  projectId: "97e0397b-2d8a-4d66-b167-784ddb6526f8",
  apiKey: process.env.BRAINTRUST_API_KEY,
});

// Wrap the Claude SDK with Braintrust tracing
const { query } = wrapClaudeAgentSDK(claudeSDK);

// Pending answer callbacks by session ID (use Redis in production)
const pendingAnswers = new Map<
  string,
  (answers: Record<string, string>) => void
>();

export const claudeRouter = t.router({
  chat: t.procedure
    .input(
      z.object({
        message: z.string(),
        sessionId: z.string().optional(),
        appendSystemPrompt: z.string().optional(),
      })
    )
    .mutation(async function* ({ input }) {
      let sessionId: string | undefined = input.sessionId;

      for await (const event of query({
        prompt: input.message,
        options: {
          settingSources: ["project"], // enables skills !!!
          resume: input.sessionId,
          env: {
            PATH: process.env.PATH,
            MORPH_API_KEY: process.env.MORPH_API_KEY,
          },
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: input.appendSystemPrompt,
          },
          canUseTool: async (toolName, toolInput) => {
            if (toolName === "AskUserQuestion" && sessionId) {
              const sid = sessionId; // Capture for closure
              const answers = await new Promise<Record<string, string>>(
                (resolve) => {
                  pendingAnswers.set(sid, resolve);
                }
              );
              return {
                behavior: "allow",
                updatedInput: { ...toolInput, answers },
              };
            }
            return { behavior: "allow", updatedInput: toolInput };
          },
        },
      })) {
        // Capture session ID from init event
        const e = event as {
          type?: string;
          subtype?: string;
          session_id?: string;
        };
        if (e.type === "system" && e.subtype === "init" && e.session_id) {
          sessionId = e.session_id;
        }
        yield event;
      }
    }),

  submitAnswers: t.procedure
    .input(
      z.object({
        sessionId: z.string(),
        answers: z.record(z.string(), z.string()),
      })
    )
    .mutation(({ input }) => {
      const resolve = pendingAnswers.get(input.sessionId);
      if (!resolve) {
        return { success: false as const, error: "No pending questions" };
      }
      resolve(input.answers);
      pendingAnswers.delete(input.sessionId);
      return { success: true as const };
    }),
});
