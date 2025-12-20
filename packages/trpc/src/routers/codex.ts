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
        accessToken:
          "eyJhbGciOiJSUzI1NiIsImtpZCI6IjE5MzQ0ZTY1LWJiYzktNDRkMS1hOWQwLWY5NTdiMDc5YmQwZSIsInR5cCI6IkpXVCJ9.eyJhdWQiOlsiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MSJdLCJjbGllbnRfaWQiOiJhcHBfRU1vYW1FRVo3M2YwQ2tYYVhwN2hyYW5uIiwiZXhwIjoxNzY2NTQ0MjY5LCJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiODY1YjY2MWYtNWQ2Yi00MTc2LWIwYTQtMmU5MDM4MmVkZjI2IiwiY2hhdGdwdF9hY2NvdW50X3VzZXJfaWQiOiJ1c2VyLVpTVXVrNjROa1ZoUWFhVlRWNkR2SHRYSV9fODY1YjY2MWYtNWQ2Yi00MTc2LWIwYTQtMmU5MDM4MmVkZjI2IiwiY2hhdGdwdF9jb21wdXRlX3Jlc2lkZW5jeSI6Im5vX2NvbnN0cmFpbnQiLCJjaGF0Z3B0X3BsYW5fdHlwZSI6InBybyIsImNoYXRncHRfdXNlcl9pZCI6InVzZXItWlNVdWs2NE5rVmhRYWFWVFY2RHZIdFhJIiwidXNlcl9pZCI6InVzZXItWlNVdWs2NE5rVmhRYWFWVFY2RHZIdFhJIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vbWZhIjp7InJlcXVpcmVkIjoieWVzIn0sImh0dHBzOi8vYXBpLm9wZW5haS5jb20vcHJvZmlsZSI6eyJlbWFpbCI6ImNhbUBkdWJkdWJkdWIueHl6IiwiZW1haWxfdmVyaWZpZWQiOnRydWV9LCJpYXQiOjE3NjU2ODAyNjgsImlzcyI6Imh0dHBzOi8vYXV0aC5vcGVuYWkuY29tIiwianRpIjoiOTdjZGQwMjktNmE0YS00OWQ4LWIyNjYtOWQ2ZmI3NzZmZGVjIiwibmJmIjoxNzY1NjgwMjY4LCJwd2RfYXV0aF90aW1lIjoxNzY1NjgwMjUyODQzLCJzY3AiOlsib3BlbmlkIiwicHJvZmlsZSIsImVtYWlsIiwib2ZmbGluZV9hY2Nlc3MiXSwic2Vzc2lvbl9pZCI6ImF1dGhzZXNzX1hSZGgxYmUzazJXTzZqeGJDVXhaUE1ZZyIsInN1YiI6ImF1dGgwfDY1YjI4YjIyZTNhM2Q1YjczNDkxZDQxMiJ9.P1qvnM8RzbjSIj9BoC3BcuxoY8OcjCgeNPIfQqYAb5oyzkbrV1D4s9OUGLyE8CnxPeZCfk6JzTryFBghmNkYJhPDRQEMDPQGVV6RE0giEElqKIJjBkxSM1k-UzMS61V7L33XIle-q8_8Es16ilXQxCswzULyIyXFuYBqlYo95F9_qqd-fXtmS94j_YHd37-_8j2o9L-k9HPsvXZB7FGQSO4Vopkm6TCQxS30F1Z-zS-uSv_Z818n7S9BpWrqGOIS78vBALM129vYlaHbEhAFfGrAC8sbsAJLsXFEwwMHg1XpFFHQ0ESJhqDDxfzJp4fCDOvFmnGZ0cLxV1TbmBFAUDRSFan12WD3MqTmT4t_-WmROGXMY5-Lk0jm24BUVzqnnkOoepNOvP4Lae_Jwz8vSlMJnlespwWLGlTgi4U6ZbRj44mV8-zvl2_EPdx6oLwKOft_NHbVzD0LvOYtuBvG064_52DP6WZMGTiYT9Ngof6vWi4_l-Ak3Z4gvZZnG4layUaWuNulBZIbNmGmXPC4_rhnudnJ_WdEdnqdC4ta70Jt9l6Rv2ol1QtASWds1MJraU1mHMGCrwHZbq4s68V4PY9IHOmNrEm72sQRI0D8YN2uFDKQPEw5B0II_wYxau1sDaaxNVLa_wMVqeR7bIB91IUK_9VKf6nizRWxpt-9JEQ",
        idToken:
          "eyJhbGciOiJSUzI1NiIsImtpZCI6ImIxZGQzZjhmLTlhYWQtNDdmZS1iMGU3LWVkYjAwOTc3N2Q2YiIsInR5cCI6IkpXVCJ9.eyJhdF9oYXNoIjoiQzZadWZ2RkhjazczZmh1WE9EN3ZjdyIsImF1ZCI6WyJhcHBfRU1vYW1FRVo3M2YwQ2tYYVhwN2hyYW5uIl0sImF1dGhfcHJvdmlkZXIiOiJwYXNzd29yZCIsImF1dGhfdGltZSI6MTc2NTY4MDI1MiwiZW1haWwiOiJjYW1AZHViZHViZHViLnh5eiIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJleHAiOjE3NjU2ODM4NjgsImh0dHBzOi8vYXBpLm9wZW5haS5jb20vYXV0aCI6eyJjaGF0Z3B0X2FjY291bnRfaWQiOiI4NjViNjYxZi01ZDZiLTQxNzYtYjBhNC0yZTkwMzgyZWRmMjYiLCJjaGF0Z3B0X3BsYW5fdHlwZSI6InBybyIsImNoYXRncHRfc3Vic2NyaXB0aW9uX2FjdGl2ZV9zdGFydCI6IjIwMjUtMDktMjhUMDk6MzQ6MDYrMDA6MDAiLCJjaGF0Z3B0X3N1YnNjcmlwdGlvbl9hY3RpdmVfdW50aWwiOiIyMDI1LTEyLTI4VDA5OjM0OjA2KzAwOjAwIiwiY2hhdGdwdF9zdWJzY3JpcHRpb25fbGFzdF9jaGVja2VkIjoiMjAyNS0xMi0xNFQwMjo0NDoxMi44NDM4MzQrMDA6MDAiLCJjaGF0Z3B0X3VzZXJfaWQiOiJ1c2VyLVpTVXVrNjROa1ZoUWFhVlRWNkR2SHRYSSIsImdyb3VwcyI6WyJhcGktZGF0YS1zaGFyaW5nLWluY2VudGl2ZXMtcHJvZ3JhbSIsInZlcmlmaWVkLW9yZ2FuaXphdGlvbiJdLCJvcmdhbml6YXRpb25zIjpbeyJpZCI6Im9yZy1rYlRlWEJpNWZVS2FwMHNRSDFZM05sM2MiLCJpc19kZWZhdWx0IjpmYWxzZSwicm9sZSI6Im93bmVyIiwidGl0bGUiOiJTd2l0Y2hib2FyZCJ9LHsiaWQiOiJvcmctOWZHT09kVkl4a21sNkNjR1U3czZjalBZIiwiaXNfZGVmYXVsdCI6dHJ1ZSwicm9sZSI6Im93bmVyIiwidGl0bGUiOiJkdWJkdWJkdWIgbGFicyBJbmNvcnBvcmF0ZWQifSx7ImlkIjoib3JnLWdGNkxEUkZmMGpOMHV3WkhWODhmbDZObyIsImlzX2RlZmF1bHQiOmZhbHNlLCJyb2xlIjoib3duZXIiLCJ0aXRsZSI6IlBlcnNvbmFsIn1dLCJ1c2VyX2lkIjoidXNlci1aU1V1azY0TmtWaFFhYVZUVjZEdkh0WEkifSwiaWF0IjoxNzY1NjgwMjY4LCJpc3MiOiJodHRwczovL2F1dGgub3BlbmFpLmNvbSIsImp0aSI6ImIwYjQyNThjLWIwZDQtNDM3Yy05MmRkLTdiOTQ1NzIwZWI1NiIsInJhdCI6MTc2NTY4MDIyNywic2lkIjoiZjNjMzM5YmUtOTU2NS00OGNmLWI5MWQtMDM2OWU5NzI5M2Y0Iiwic3ViIjoiYXV0aDB8NjViMjhiMjJlM2EzZDViNzM0OTFkNDEyIn0.wbR3TT9Fv8IavX6YYQ4yMOMRQoD0n_HExecHAnhDfwiN5BW9Ax27w49u3_Ru1AVdvLHRX-tZ3WZh_QZWBgaaPF-E8XVuCJ47OVPLtshiTQaE_sxYlSusa4NY3rrIIdq1oJTxKUcZOL1bwk3P7qEprzM8sTyoehMzRZsgRUdyT0Z-elAJv6O6DW0JommrA4xG8DI3DsI9W_2l73EBChMiuJZAezsgJDi2YNMw4H_TZ6IiZfhb2TK0H5WsFIUMOP7LcQg04772lZttAAAXQzaqOuPsEhEythggpyn-OOpWU9J0bdg7at84yS04zHu5cHOIlIeW5XsZMFWZtZ7YUrOOBNpHXJg4XeuFft016KjG-WX5kYj83hE1D3Y0wX-5DpQQEpsYJ_aDYXzFTgEm-MTAKzi9O48NdxAW59dn7ExoRSISPebe0_i69QGAOkdSu9JP_DM6vtS0UzAUjxDoB8CqTW7N4qqd1IBLO_VvVcEffSvnphva-AkPgS4XRMMaenQnSMe3nIGadVP4qG4nNcMwfSYdHsZqfUKZHnAIKUP3kvvFTAJzlgpBUPYE3XUCTOZw1HGpOC4nJSy9dsf4xFbMHIhlv-WDD9PeWHqtO-zTYaS0qKBAbr_KWZcqm1dgOtiAVXAnZU9umGeIKLPt6_VGMNEyL9S1YF5AuVqKfeazwTE",
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
