import { EventEmitter } from "node:events";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { query } from "@anthropic-ai/claude-agent-sdk";
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
  tasks,
} from "@trigger.dev/sdk";
import { Client } from "ssh2";
import { z } from "zod";

// ============================================================================
// Stream Definitions
// ============================================================================

/**
 * Event types streamed from the Claude agent task.
 */
export type ClaudeEvent =
  | { type: "init"; sessionId: string }
  | { type: "text"; content: string }
  | { type: "tool.start"; toolId: string; name: string; input?: string }
  | { type: "tool.done"; toolId: string; output: string }
  | { type: "result"; durationMs?: number; costUsd?: number }
  | { type: "error"; message: string };

/**
 * Stream for Claude agent events (as JSON strings for reliable serialization).
 */
export const claudeEventStream: ReturnType<typeof streams.define<string>> =
  streams.define<string>({
    id: "claude-events",
  });

/** Append a typed event to the stream as JSON */
async function emitEvent(event: ClaudeEvent) {
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

  logger.debug("[SSH] Full command", { command: commandWithEnv });

  return commandWithEnv;
}

type SshChannelContext = {
  sshClient: Client;
  command: string;
  options: SpawnOptions;
  stdinPassthrough: PassThrough;
  stdoutPassthrough: PassThrough;
  emitter: EventEmitter;
  state: { killed: boolean; exitCode: number | null };
};

function setupSshChannel(ctx: SshChannelContext) {
  ctx.sshClient.exec(ctx.command, { pty: false }, (err, channel) => {
    if (err) {
      logger.error("SSH exec error", { error: err.message });
      ctx.emitter.emit("error", err);
      ctx.stdoutPassthrough.destroy(err);
      return;
    }

    ctx.stdinPassthrough.pipe(channel);
    channel.pipe(ctx.stdoutPassthrough);

    channel.stderr.on("data", (data: Buffer) => {
      logger.warn("[SSH stderr]", { stderr: data.toString() });
    });

    ctx.options.signal.addEventListener("abort", () => {
      if (!ctx.state.killed) {
        ctx.state.killed = true;
        logger.info("Aborting SSH process");
        // Send SIGINT first (Ctrl+C behavior)
        channel.signal("INT");
        setTimeout(() => {
          // Send SIGKILL if still running
          channel.signal("KILL");
          setTimeout(() => {
            channel.close();
            ctx.sshClient.end();
          }, 500);
        }, 500);
      }
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
  const state = { killed: false, exitCode: null as number | null };

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
      if (state.killed) {
        return false;
      }
      state.killed = true;
      sshClient.end();
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

// ============================================================================
// Event Processing
// ============================================================================

type RawEvent = {
  type?: string;
  subtype?: string;
  session_id?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: unknown;
      content?: string | unknown;
      tool_use_id?: string;
    }>;
  };
  duration_ms?: number;
  total_cost_usd?: number;
};

async function handleInitEvent(e: RawEvent): Promise<string | undefined> {
  if (e.type === "system" && e.subtype === "init" && e.session_id) {
    await emitEvent({ type: "init", sessionId: e.session_id });
    return e.session_id;
  }
  return;
}

async function handleAssistantEvent(e: RawEvent): Promise<boolean> {
  if (e.type !== "assistant" || !e.message?.content) {
    return false;
  }

  for (const block of e.message.content) {
    if (block.type === "text" && block.text) {
      await emitEvent({ type: "text", content: block.text });
    } else if (block.type === "tool_use" && block.name && block.id) {
      await emitEvent({
        type: "tool.start",
        toolId: block.id,
        name: block.name,
        input: block.input ? JSON.stringify(block.input, null, 2) : undefined,
      });
    }
  }
  return true;
}

async function handleUserEvent(e: RawEvent): Promise<boolean> {
  if (e.type !== "user" || !e.message?.content) {
    return false;
  }

  for (const block of e.message.content) {
    if (block.type === "tool_result") {
      const toolId = block.tool_use_id || block.id;
      if (toolId) {
        const output =
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
        await emitEvent({ type: "tool.done", toolId, output });
      }
    }
  }
  return true;
}

async function handleResultEvent(e: RawEvent): Promise<boolean> {
  if (e.type !== "result") {
    return false;
  }

  await emitEvent({
    type: "result",
    durationMs: e.duration_ms,
    costUsd: e.total_cost_usd,
  });
  return true;
}

async function processClaudeEvent(
  event: unknown,
  currentSessionId: string | undefined
): Promise<string | undefined> {
  const e = event as RawEvent;

  const initSessionId = await handleInitEvent(e);
  if (initSessionId) {
    return initSessionId;
  }

  if (await handleAssistantEvent(e)) {
    return currentSessionId;
  }
  if (await handleUserEvent(e)) {
    return currentSessionId;
  }
  await handleResultEvent(e);

  return currentSessionId;
}

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
  run: async (payload, { signal }) => {
    const abortController = new AbortController();

    signal.addEventListener("abort", () => {
      logger.info("Task cancelled, aborting Claude process");
      abortController.abort();
    });

    tasks.onCancel(() => {
      logger.info("onCancel hook: ensuring process termination");
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
        sessionId = await processClaudeEvent(event, sessionId);
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
