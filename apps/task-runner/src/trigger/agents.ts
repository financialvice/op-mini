import { EventEmitter } from "node:events";
import { PassThrough, type Readable, type Writable } from "node:stream";
import {
  query,
  type SDKMessage,
  type SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  SpawnedProcess,
  SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk/transport/processTransportTypes";
import {
  AbortTaskRunError,
  logger,
  runs,
  schemaTask,
  streams,
} from "@trigger.dev/sdk";
import { Client, type ClientChannel } from "ssh2";
import { z } from "zod";

// ============================================================================
// Stream Definitions
// ============================================================================

/**
 * Stream for Claude agent events (as JSON strings for reliable serialization).
 */
export const claudeEventStream: ReturnType<typeof streams.define<string>> =
  streams.define<string>({
    id: "claude-events",
  });

type StreamError = { type: "error"; message: string };
type ClaudeStreamEvent = SDKMessage | StreamError;

/** Append a typed event to the stream as JSON */
async function emitEvent(event: ClaudeStreamEvent) {
  await claudeEventStream.append(JSON.stringify(event));
}

// ============================================================================
// SSH Spawn for MorphCloud
// ============================================================================

const MORPH_SSH_HOST = "ssh.cloud.morph.so";
const MORPH_SSH_PORT = 22;

type MorphConfig = {
  apiKey: string;
  instanceId: string;
  sshPrivateKey: string;
};

function buildSshCommand(options: SpawnOptions): string {
  // Match simp-claude.ts exactly
  const cliArgs = options.args.filter((arg) => !arg.includes("cli.js"));
  const fullCommand = ["claude", ...cliArgs].join(" ");

  const remoteEnvVars = Object.entries(options.env)
    .filter(([k, v]) => v !== undefined && k !== "PATH")
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join("; ");

  const remotePath = "export PATH=$PATH:/usr/local/bin:/root/.local/bin";

  const commandWithEnv = [remotePath, remoteEnvVars, fullCommand]
    .filter(Boolean)
    .join("; ");

  const wrappedCommand = `bash -lc ${JSON.stringify(
    `trap 'kill -- -$$' EXIT INT TERM; ${commandWithEnv}`
  )}`;

  logger.debug("[SSH] Full command", { command: commandWithEnv });

  return wrappedCommand;
}

type SshChannelContext = {
  sshClient: Client;
  command: string;
  options: SpawnOptions;
  stdinPassthrough: PassThrough;
  stdoutPassthrough: PassThrough;
  emitter: EventEmitter;
  state: { killed: boolean; exitCode: number | null; channel?: ClientChannel };
  terminate: (reason: string) => void;
};

function setupSshChannel(ctx: SshChannelContext) {
  ctx.sshClient.exec(ctx.command, { pty: false }, (err, channel) => {
    if (err) {
      logger.error("SSH exec error", { error: err.message });
      ctx.emitter.emit("error", err);
      ctx.stdoutPassthrough.destroy(err);
      return;
    }

    ctx.state.channel = channel;
    ctx.stdinPassthrough.pipe(channel);
    channel.pipe(ctx.stdoutPassthrough);

    channel.stderr.on("data", (data: Buffer) => {
      logger.warn("[SSH stderr]", { stderr: data.toString() });
    });

    ctx.options.signal.addEventListener("abort", () => {
      ctx.terminate("abort");
    });

    channel.on("exit", (code: number | null, signal: string | null) => {
      logger.info("SSH process exited", { code, signal });
      ctx.state.exitCode = code;
      ctx.state.killed = signal !== null;
      ctx.emitter.emit(
        "exit",
        code,
        signal ? (signal as NodeJS.Signals) : null
      );
    });

    channel.on("close", () => {
      ctx.stdoutPassthrough.end();
      ctx.sshClient.end();
    });
  });
}

/**
 * Creates a SpawnedProcess that runs Claude on a MorphCloud VM via SSH.
 */
function createMorphSpawnedProcess(
  config: MorphConfig,
  options: SpawnOptions
): SpawnedProcess {
  const emitter = new EventEmitter();
  const sshClient = new Client();
  const stdinPassthrough = new PassThrough();
  const stdoutPassthrough = new PassThrough();
  const state = {
    killed: false,
    exitCode: null as number | null,
    channel: undefined as ClientChannel | undefined,
  };

  const terminate = (reason: string) => {
    if (state.killed) {
      return;
    }
    state.killed = true;
    logger.info("Aborting SSH process", { reason });

    if (state.channel) {
      try {
        state.channel.signal("INT");
      } catch (error) {
        logger.debug("Failed to send SIGINT", { error });
      }
      try {
        state.channel.signal("TERM");
      } catch (error) {
        logger.debug("Failed to send SIGTERM", { error });
      }
      try {
        state.channel.close();
      } catch (error) {
        logger.debug("Failed to close SSH channel", { error });
      }
    }

    sshClient.end();
  };

  const command = buildSshCommand(options);
  logger.info("SSH connecting", { host: MORPH_SSH_HOST });

  sshClient.on("ready", () => {
    logger.info("SSH connected, executing command");
    setupSshChannel({
      sshClient,
      command,
      options,
      stdinPassthrough,
      stdoutPassthrough,
      emitter,
      state,
      terminate,
    });
  });

  sshClient.on("error", (err) => {
    logger.error("SSH connection error", { error: err.message });
    emitter.emit("error", err);
    stdoutPassthrough.destroy(err);
  });

  sshClient.connect({
    host: MORPH_SSH_HOST,
    port: MORPH_SSH_PORT,
    username: `${config.instanceId}:${config.apiKey}`,
    privateKey: config.sshPrivateKey,
  });

  return {
    stdin: stdinPassthrough as Writable,
    stdout: stdoutPassthrough as Readable,
    get killed() {
      return state.killed;
    },
    get exitCode() {
      return state.exitCode;
    },
    kill(): boolean {
      terminate("kill");
      return true;
    },
    on(event, listener) {
      emitter.on(event, listener);
    },
    once(event, listener) {
      emitter.once(event, listener);
    },
    off(event, listener) {
      emitter.off(event, listener);
    },
  };
}

const isSessionInit = (event: SDKMessage): event is SDKSystemMessage =>
  event.type === "system" && event.subtype === "init";

const runAbortControllers = new Map<string, AbortController>();

// ============================================================================
// Task Definition
// ============================================================================

const claudeAgentPayload = z.object({
  prompt: z.string(),
  sessionId: z.string().optional(),
  morphInstanceId: z.string(),
});

export type ClaudeAgentPayload = z.infer<typeof claudeAgentPayload>;

/**
 * Claude agent task that runs on a remote MorphCloud VM.
 *
 * - Streams events via `claudeEventStream`
 * - Supports cancellation via `runs.cancel(runId)`
 * - Automatically cleans up SSH connection on cancel
 */
export const claudeAgent = schemaTask({
  id: "claude-agent",
  description: "Run Claude Code agent on MorphCloud VM",
  schema: claudeAgentPayload,
  retry: { maxAttempts: 1 },
  onCancel: ({ ctx }) => {
    const controller = runAbortControllers.get(ctx.run.id);
    if (controller) {
      logger.info("onCancel hook: aborting Claude process", {
        runId: ctx.run.id,
      });
      controller.abort();
    }
  },
  run: async (payload, { signal, ctx }) => {
    const abortController = new AbortController();
    runAbortControllers.set(ctx.run.id, abortController);

    signal.addEventListener("abort", () => {
      logger.info("Task cancelled, aborting Claude process");
      abortController.abort();
    });

    // Get secrets from environment
    const morphApiKey = process.env.MORPH_API_KEY;
    const morphSshPrivateKey = process.env.MORPH_SSH_PRIVATE_KEY;
    const claudeOauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

    if (!(morphApiKey && morphSshPrivateKey && claudeOauthToken)) {
      throw new Error(
        "Missing required env vars: MORPH_API_KEY, MORPH_SSH_PRIVATE_KEY, CLAUDE_CODE_OAUTH_TOKEN"
      );
    }

    const morphConfig: MorphConfig = {
      apiKey: morphApiKey,
      instanceId: payload.morphInstanceId,
      sshPrivateKey: morphSshPrivateKey,
    };

    let sessionId: string | undefined = payload.sessionId;

    try {
      for await (const event of query({
        prompt: payload.prompt,
        options: {
          abortController,
          settingSources: ["project"],
          resume: payload.sessionId,
          permissionMode: "bypassPermissions",
          env: {
            PATH: process.env.PATH,
            MORPH_API_KEY: morphApiKey,
            CLAUDE_CODE_OAUTH_TOKEN: claudeOauthToken,
            IS_SANDBOX: "true",
          },
          systemPrompt: { type: "preset", preset: "claude_code" },
          spawnClaudeCodeProcess: (opts) =>
            createMorphSpawnedProcess(morphConfig, opts),
        },
      })) {
        if (isSessionInit(event)) {
          sessionId = event.session_id;
        }
        await emitEvent(event);
      }

      return { sessionId, status: "completed" as const };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        logger.info("Claude process aborted");
        await emitEvent({ type: "error", message: "Cancelled" });
        throw new AbortTaskRunError("Task was cancelled");
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Claude agent error", { error: message });
      await emitEvent({ type: "error", message });
      throw error;
    } finally {
      runAbortControllers.delete(ctx.run.id);
    }
  },
});

// ============================================================================
// Helpers for external consumers
// ============================================================================

/**
 * Trigger the Claude agent task and return the run handle.
 */
export function triggerClaudeAgent(payload: ClaudeAgentPayload) {
  return claudeAgent.trigger(payload);
}

/**
 * Cancel a running Claude agent task.
 */
export function cancelClaudeAgent(
  runId: string
): ReturnType<typeof runs.cancel> {
  return runs.cancel(runId);
}
