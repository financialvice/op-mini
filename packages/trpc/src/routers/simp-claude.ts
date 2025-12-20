import { EventEmitter } from "node:events";
import { PassThrough, type Readable, type Writable } from "node:stream";
import * as claudeSDK from "@anthropic-ai/claude-agent-sdk";
import type {
  SpawnedProcess,
  SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk/transport/processTransportTypes";
import { initLogger, wrapClaudeAgentSDK } from "braintrust";
import { Client } from "ssh2";
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

// MorphCloud SSH configuration
const MORPH_SSH_HOST = "ssh.cloud.morph.so";
const MORPH_SSH_PORT = 22;
const MORPH_API_KEY = process.env.MORPH_API_KEY;
const MORPH_INSTANCE_ID = process.env.MORPH_INSTANCE_ID;
const MORPH_SSH_PRIVATE_KEY = process.env.MORPH_SSH_PRIVATE_KEY;

if (!(MORPH_API_KEY && MORPH_INSTANCE_ID && MORPH_SSH_PRIVATE_KEY)) {
  throw new Error(
    "Missing required environment variables: MORPH_API_KEY, MORPH_INSTANCE_ID, MORPH_SSH_PRIVATE_KEY"
  );
}

/**
 * Creates a SpawnedProcess that runs commands on a MorphCloud VM via SSH.
 * The connection is established asynchronously but the interface is synchronous.
 */
function createMorphSpawnedProcess(options: SpawnOptions) {
  const emitter = new EventEmitter();
  const sshClient = new Client();

  // Create passthrough streams that we return immediately
  // These will be piped to/from the SSH channel once connected
  const stdinPassthrough = new PassThrough();
  const stdoutPassthrough = new PassThrough();

  let _killed = false;
  let _exitCode: number | null = null;

  // Build the command string
  // The SDK passes: command="node", args=["/local/path/to/cli.js", "--flag1", ...]
  // We replace this with just "claude" + the flags (skip node and the cli.js path)
  const cliArgs = options.args.filter((arg) => !arg.includes("cli.js"));
  const fullCommand = ["claude", ...cliArgs].join(" ");

  // Filter out local PATH and other machine-specific env vars
  // Only pass through relevant env vars to the remote machine
  const remoteEnvVars = Object.entries(options.env)
    .filter(([k, v]) => v !== undefined && k !== "PATH")
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join("; ");

  // Use the remote machine's PATH with claude's install location
  const remotePath = "export PATH=$PATH:/usr/local/bin:/root/.local/bin";

  const commandWithEnv = [remotePath, remoteEnvVars, fullCommand]
    .filter(Boolean)
    .join("; ");

  // Debug: log the command being executed
  console.log("[SSH] Connecting to:", MORPH_SSH_HOST);
  console.log("[SSH] Full command:", commandWithEnv);

  // Connect SSH asynchronously
  sshClient.on("ready", () => {
    console.log("[SSH] Connected, executing command...");
    sshClient.exec(commandWithEnv, { pty: false }, (err, channel) => {
      if (err) {
        console.error("[SSH] Exec error:", err);
        emitter.emit("error", err);
        stdoutPassthrough.destroy(err);
        return;
      }

      // Pipe stdin to channel, channel stdout to our stdout
      stdinPassthrough.pipe(channel);
      channel.pipe(stdoutPassthrough);

      // Capture stderr for debugging
      let stderrData = "";
      channel.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        stderrData += text;
        console.error("[SSH stderr]", text);
      });

      // Handle abort signal
      options.signal.addEventListener("abort", () => {
        if (!_killed) {
          _killed = true;
          channel.signal("TERM");
          // Give it a moment, then force close
          setTimeout(() => {
            channel.close();
            sshClient.end();
          }, 1000);
        }
      });

      // Handle channel exit
      channel.on("exit", (code: number | null, signal: string | null) => {
        console.log("[SSH] Process exited with code:", code, "signal:", signal);
        if (stderrData) {
          console.error("[SSH] Full stderr:", stderrData);
        }
        _exitCode = code;
        _killed = signal !== null;
        emitter.emit("exit", code, signal ? (signal as NodeJS.Signals) : null);
      });

      channel.on("close", () => {
        stdoutPassthrough.end();
        sshClient.end();
      });
    });
  });

  sshClient.on("error", (err) => {
    emitter.emit("error", err);
    stdoutPassthrough.destroy(err);
  });

  // Start the SSH connection
  sshClient.connect({
    host: MORPH_SSH_HOST,
    port: MORPH_SSH_PORT,
    username: `${MORPH_INSTANCE_ID}:${MORPH_API_KEY}`,
    privateKey: MORPH_SSH_PRIVATE_KEY,
  });

  // Return SpawnedProcess-compatible object
  const spawnedProcess: SpawnedProcess = {
    stdin: stdinPassthrough as Writable,
    stdout: stdoutPassthrough as Readable,
    get killed() {
      return _killed;
    },
    get exitCode() {
      return _exitCode;
    },
    kill(_signal: NodeJS.Signals): boolean {
      if (_killed) {
        return false;
      }
      _killed = true;
      // The SSH channel kill will happen via the abort signal listener
      // For now just end the client
      sshClient.end();
      return true;
    },
    on(
      event: "exit" | "error",
      listener:
        | ((code: number | null, signal: NodeJS.Signals | null) => void)
        | ((error: Error) => void)
    ): void {
      emitter.on(event, listener);
    },
    once(
      event: "exit" | "error",
      listener:
        | ((code: number | null, signal: NodeJS.Signals | null) => void)
        | ((error: Error) => void)
    ): void {
      emitter.once(event, listener);
    },
    off(
      event: "exit" | "error",
      listener:
        | ((code: number | null, signal: NodeJS.Signals | null) => void)
        | ((error: Error) => void)
    ): void {
      emitter.off(event, listener);
    },
  };
  return spawnedProcess;
}

export const simpClaudeRouter = t.router({
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
            MORPH_API_KEY: "morph_DNwxus9LQCG5Z5F5QVLnNW",
            CLAUDE_CODE_OAUTH_TOKEN:
              "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",
          },
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: input.appendSystemPrompt,
          },
          // Run Claude Code on MorphCloud VM instead of locally
          spawnClaudeCodeProcess: createMorphSpawnedProcess,
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
