/**
 * Codex tRPC Router
 *
 * Runs Codex app-server on a MorphCloud VM via SSH.
 * Similar pattern to simp-claude.ts but using Codex's JSON-RPC protocol.
 */

import { PassThrough } from "node:stream";
import { Client } from "ssh2";
import { z } from "zod";
import {
  CodexRpcClient,
  type ServerNotification,
  type ServerRequest,
  type UserInput,
} from "../lib/codex-rpc";
import { t } from "../server";

// Pending approval callbacks by session ID
const pendingApprovals = new Map<
  string,
  (decision: "accept" | "decline") => void
>();

// MorphCloud SSH configuration
const MORPH_SSH_HOST = "ssh.cloud.morph.so";
const MORPH_SSH_PORT = 22;
const MORPH_API_KEY = process.env.MORPH_API_KEY;
const MORPH_INSTANCE_ID = process.env.MORPH_INSTANCE_ID;
const SSH_PRIVATE_KEY = process.env.MORPH_SSH_PRIVATE_KEY;

if (!(MORPH_API_KEY && MORPH_INSTANCE_ID && SSH_PRIVATE_KEY)) {
  throw new Error(
    "Missing required environment variables: MORPH_API_KEY, MORPH_INSTANCE_ID, MORPH_SSH_PRIVATE_KEY"
  );
}

type CodexTokens = {
  accessToken: string;
  idToken?: string;
};

/**
 * Writes Codex auth.json file to the VM via SSH
 */
function writeAuthFile(sshClient: Client, tokens: CodexTokens): Promise<void> {
  return new Promise((resolve, reject) => {
    const authJson = JSON.stringify({
      OPENAI_API_KEY: null,
      tokens: {
        id_token: tokens.idToken ?? tokens.accessToken,
        access_token: tokens.accessToken,
        refresh_token: "managed-externally",
      },
      last_refresh: new Date().toISOString(),
    });

    const cmd = `mkdir -p ~/.codex && cat > ~/.codex/auth.json << 'AUTHEOF'
${authJson}
AUTHEOF
chmod 600 ~/.codex/auth.json`;

    sshClient.exec(cmd, (err, channel) => {
      if (err) {
        reject(err);
        return;
      }
      channel.on("close", () => {
        console.log("[Codex SSH] Auth file written");
        resolve();
      });
      channel.on("data", () => {
        // Ignore stdout from auth file write
      });
      channel.stderr.on("data", (data: Buffer) => {
        console.error("[Codex auth stderr]", data.toString());
      });
    });
  });
}

/**
 * Creates a CodexRpcClient connected to a MorphCloud VM via SSH
 */
function createCodexClient(tokens?: CodexTokens): Promise<{
  client: CodexRpcClient;
  cleanup: () => void;
}> {
  return new Promise((resolve, reject) => {
    const sshClient = new Client();
    const stdinPassthrough = new PassThrough();
    const stdoutPassthrough = new PassThrough();

    sshClient.on("ready", async () => {
      console.log("[Codex SSH] Connected");

      // Write auth file if tokens provided
      if (tokens) {
        try {
          await writeAuthFile(sshClient, tokens);
        } catch (err) {
          reject(err);
          return;
        }
      }

      console.log("[Codex SSH] Starting app-server...");
      sshClient.exec("codex app-server", { pty: false }, (err, channel) => {
        if (err) {
          reject(err);
          return;
        }

        // Pipe streams
        stdinPassthrough.pipe(channel);
        channel.pipe(stdoutPassthrough);

        // Log stderr
        channel.stderr.on("data", (data: Buffer) => {
          console.error("[Codex stderr]", data.toString());
        });

        const client = new CodexRpcClient(stdinPassthrough, stdoutPassthrough);

        const cleanup = () => {
          channel.close();
          sshClient.end();
        };

        resolve({ client, cleanup });
      });
    });

    sshClient.on("error", reject);

    sshClient.connect({
      host: MORPH_SSH_HOST,
      port: MORPH_SSH_PORT,
      username: `${MORPH_INSTANCE_ID}:${MORPH_API_KEY}`,
      privateKey: SSH_PRIVATE_KEY,
    });
  });
}

export const codexRouter = t.router({
  /**
   * Get thread history (resumes thread and returns conversation)
   */
  getThreadHistory: t.procedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ input }) => {
      const tokens = {
        accessToken: process.env.CODEX_ACCESS_TOKEN!,
        idToken: process.env.CODEX_ID_TOKEN!,
      };
      const { client, cleanup } = await createCodexClient(tokens);

      try {
        await client.initialize();
        const result = await client.threadResume(input.threadId);
        return result;
      } finally {
        cleanup();
      }
    }),

  /**
   * List threads with pagination
   */
  listThreads: t.procedure
    .input(
      z
        .object({
          cursor: z.string().nullish(),
          limit: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      // Hardcoded tokens for now
      const tokens = {
        accessToken: process.env.CODEX_ACCESS_TOKEN!,
        idToken: process.env.CODEX_ID_TOKEN!,
      };
      const { client, cleanup } = await createCodexClient(tokens);

      try {
        await client.initialize();
        const result = await client.threadList({
          cursor: input?.cursor ?? null,
          limit: input?.limit ?? 20,
        });
        return result;
      } finally {
        cleanup();
      }
    }),

  /**
   * Main chat endpoint - streams Codex events
   */
  chat: t.procedure
    .input(
      z.object({
        message: z.string(),
        threadId: z.string().optional(),
        cwd: z.string().optional(),
        accessToken: z.string().optional(),
        idToken: z.string().optional(),
      })
    )
    .mutation(async function* ({ input }) {
      // Hardcoded tokens for now
      const tokens = {
        accessToken: process.env.CODEX_ACCESS_TOKEN!,
        idToken: process.env.CODEX_ID_TOKEN!,
      };
      const { client, cleanup } = await createCodexClient(tokens);

      try {
        // Initialize the connection
        await client.initialize();

        // Start or resume thread
        let threadId = input.threadId;
        if (threadId) {
          await client.threadResume(threadId);
        } else {
          const { thread } = await client.threadStart({
            cwd: input.cwd ?? "/home/user",
          });
          threadId = thread.id;
          yield { type: "thread.started" as const, threadId };
        }

        // Set up event queue
        type QueueEvent = ServerNotification | { type: "done" };
        const events: QueueEvent[] = [];
        let resolveNext: (() => void) | null = null;

        const pushEvent = (event: QueueEvent) => {
          events.push(event);
          resolveNext?.();
        };

        // Set up handlers
        client.setHandlers({
          onNotification: (notification) => {
            console.log("[Codex notification]", JSON.stringify(notification));
            pushEvent(notification);
          },
          onClose: () => {
            console.log("[Codex] Connection closed");
            pushEvent({ type: "done" });
          },
          onApprovalRequest: (request: ServerRequest) => {
            console.log("[Codex approval request]", JSON.stringify(request));
            client.respondToRequest(request.id, { decision: "accept" });
          },
        });

        // Start the turn
        const userInput: UserInput = { type: "text", text: input.message };
        await client.turnStart({
          threadId,
          input: [userInput],
          cwd: null,
          approvalPolicy: null,
          sandboxPolicy: null,
          model: null,
          effort: null,
          summary: null,
        });

        // Yield events as they come in
        while (true) {
          if (events.length === 0) {
            await new Promise<void>((r) => {
              resolveNext = r;
            });
          }

          const event = events.shift();
          if (!event) {
            continue;
          }

          if ("type" in event && event.type === "done") {
            console.log("[Codex] Done event received, breaking loop");
            break;
          }

          console.log("[Codex] Yielding event:", JSON.stringify(event));
          yield event;

          // Check for turn completion
          if ("method" in event && event.method === "turn/completed") {
            break;
          }
        }
      } finally {
        cleanup();
      }
    }),

  /**
   * Submit approval decision for a pending command/file change
   */
  submitApproval: t.procedure
    .input(
      z.object({
        threadId: z.string(),
        itemId: z.string(),
        decision: z.enum(["accept", "decline"]),
      })
    )
    .mutation(({ input }) => {
      const key = `${input.threadId}:${input.itemId}`;
      const callback = pendingApprovals.get(key);

      if (!callback) {
        return { success: false as const, error: "No pending approval" };
      }

      callback(input.decision);
      return { success: true as const };
    }),
});
