import { randomUUID } from "node:crypto";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex, type ModelReasoningEffort } from "@openai/codex-sdk";
import {
  DEFAULT_CODEX_MODEL,
  getReasoningMeta,
  type ReasoningLevel,
  validateReasoningLevel,
} from "./models";
import {
  type ActiveSession,
  extractImages,
  extractText,
  type ImageContent,
  type MessageContent,
  type UnifiedEvent,
  type UnifiedUsage,
} from "./types";

const DEFAULT_WORKING_DIR = process.env.DEFAULT_WORKING_DIR ?? process.cwd();

// Default Codex client (uses ~/.codex/auth.json or OPENAI_API_KEY env var)
const defaultCodex = new Codex();

/**
 * Environment variables to inherit when using custom CODEX_HOME.
 * These are essential for the Codex CLI to function properly.
 */
const INHERITED_ENV_VARS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  // OpenAI API config (in case user has custom base URL)
  "OPENAI_BASE_URL",
];

/**
 * Create a temporary CODEX_HOME directory with auth.json containing OAuth tokens.
 *
 * Codex CLI uses ChatGPT OAuth mode when auth.json contains a `tokens` object.
 * - access_token: Used as Bearer token for API calls (aud: "https://api.openai.com/v1")
 * - id_token: Parsed for user info like email, plan_type, subscription (aud: "app_EMoamEEZ73f0CkXaXp7hrann")
 *
 * IMPORTANT: These are two DIFFERENT JWTs from OpenAI OAuth with different audiences.
 * The id_token contains identity claims, the access_token is for API authorization.
 *
 * @see https://github.com/openai/codex - codex-rs/core/src/auth.rs
 */
async function createTempCodexHome(
  accessToken: string,
  idToken: string
): Promise<{
  codexHome: string;
  cleanup: () => Promise<void>;
}> {
  const codexHome = join(tmpdir(), `codex-home-${randomUUID()}`);
  await mkdir(codexHome, { recursive: true });

  // Write auth.json in the format Codex expects for ChatGPT OAuth mode
  const authJson = {
    OPENAI_API_KEY: null,
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      // refresh_token is used for auto-refresh, but we handle refresh in our app
      refresh_token: "managed-externally",
    },
    // Set last_refresh to now so Codex doesn't try to refresh immediately
    last_refresh: new Date().toISOString(),
  };

  await writeFile(join(codexHome, "auth.json"), JSON.stringify(authJson));

  return {
    codexHome,
    cleanup: async () => {
      await rm(codexHome, { recursive: true, force: true }).catch(() => {
        // Ignore cleanup errors
      });
    },
  };
}

/**
 * Build environment variables for Codex with custom CODEX_HOME.
 * Inherits essential env vars from the current process.
 */
function buildCodexEnv(codexHome: string): Record<string, string> {
  const env: Record<string, string> = {
    CODEX_HOME: codexHome,
  };

  for (const key of INHERITED_ENV_VARS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Get a Codex client instance with optional OAuth token support.
 *
 * When oauthToken AND idToken are provided:
 * - Creates a temp CODEX_HOME with auth.json containing both tokens
 * - Configures the Codex instance to use that directory
 * - Returns codexHome path for session storage (cleanup handled by session lifecycle)
 *
 * When tokens are missing:
 * - Returns the default Codex instance (uses ~/.codex/auth.json or OPENAI_API_KEY)
 */
async function getCodexClient(
  oauthToken?: string,
  idToken?: string
): Promise<{
  codex: Codex;
  codexHome?: string;
}> {
  if (oauthToken && idToken) {
    const { codexHome } = await createTempCodexHome(oauthToken, idToken);
    const env = buildCodexEnv(codexHome);
    const codex = new Codex({ env });
    return { codex, codexHome };
  }

  return { codex: defaultCodex };
}

// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional noop
const noop = () => {};

/**
 * Get file extension from media type.
 */
function getExtension(mediaType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return map[mediaType] ?? "png";
}

/**
 * Write images to temp files and return paths + cleanup function.
 * Codex CLI requires local file paths for images.
 */
async function prepareImages(
  images: ImageContent[]
): Promise<{ paths: string[]; cleanup: () => Promise<void> }> {
  const paths: string[] = [];

  for (const img of images) {
    const ext = getExtension(img.mediaType);
    const tempPath = join(tmpdir(), `codex-${randomUUID()}.${ext}`);
    await writeFile(tempPath, Buffer.from(img.data, "base64"));
    paths.push(tempPath);
  }

  return {
    paths,
    cleanup: async () => {
      // Ignore errors - files may already be deleted
      await Promise.all(paths.map((p) => unlink(p).catch(noop)));
    },
  };
}

type CodexSession = ActiveSession & {
  threadId: string;
  /** The Codex client instance (reused for continue requests) */
  codex: Codex;
  /** Path to temp CODEX_HOME (only when using OAuth) */
  codexHome?: string;
};

const activeSessions = new Map<string, CodexSession>();

/**
 * Cleanup a session's temp CODEX_HOME directory if it exists.
 */
async function cleanupSessionCodexHome(session: CodexSession): Promise<void> {
  if (session.codexHome) {
    await rm(session.codexHome, { recursive: true, force: true }).catch(() => {
      // Ignore cleanup errors
    });
  }
}

/**
 * Codex SDK item types.
 *
 * Source: https://github.com/openai/codex
 * - TypeScript types: sdk/typescript/src/items.ts
 * - Rust source: codex-rs/exec/src/exec_events.rs
 *
 * Key item types:
 * - command_execution: Shell command with output and exit_code
 * - agent_message: Text response from the agent
 * - file_change: File modifications (not yet surfaced in unified events)
 * - mcp_tool_call: MCP tool invocations (not yet surfaced)
 */
type CodexItem = {
  id?: string;
  type: string;
  text?: string;
  command?: string;
  output?: string;
  /** Codex uses aggregated_output in the SDK, but output in simplified form */
  aggregated_output?: string;
  exit_code?: number;
};

/**
 * Codex SDK event types.
 *
 * Source: https://github.com/openai/codex
 * - TypeScript types: sdk/typescript/src/events.ts
 * - Rust source: codex-rs/exec/src/exec_events.rs
 *
 * Key events:
 * - thread.started: New session with thread_id
 * - turn.started: Turn begins (no payload)
 * - turn.completed: Turn ends with usage stats (only timing-adjacent data available)
 * - item.started/completed: Tool execution lifecycle
 * - error: Fatal errors
 *
 * Note: Codex does NOT provide duration or cost data in events.
 * Only token usage is available via TurnCompletedEvent.usage.
 */
type CodexEvent = {
  type: string;
  thread_id?: string;
  item?: CodexItem;
  error?: { message: string };
  message?: string;
  /**
   * Usage data from TurnCompletedEvent.
   * Source: codex-rs/exec/src/exec_events.rs - Usage struct
   */
  usage?: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  };
};

function transformItemStarted(item: CodexItem): UnifiedEvent | null {
  if (item.type === "command_execution" && item.command && item.id) {
    return {
      type: "tool.start",
      timestamp: Date.now(),
      toolId: item.id,
      name: "Bash",
      input: item.command,
    };
  }
  return null;
}

function* transformItemCompleted(item: CodexItem): Generator<UnifiedEvent> {
  if (item.type === "agent_message" && item.text) {
    yield { type: "text", timestamp: Date.now(), content: item.text };
  }
  if (item.type === "command_execution" && item.id) {
    yield {
      type: "tool.done",
      timestamp: Date.now(),
      toolId: item.id,
      output:
        item.output ?? item.aggregated_output ?? `Exit code: ${item.exit_code}`,
      status: item.exit_code === 0 ? "completed" : "error",
    };
  }
}

/**
 * Transform Codex SDK usage to unified format.
 *
 * Codex provides (from codex-rs/exec/src/exec_events.rs):
 * - input_tokens: Total input tokens
 * - cached_input_tokens: Tokens served from cache
 * - output_tokens: Generated tokens
 *
 * Note: Codex has a single cached_input_tokens field, unlike Claude which
 * distinguishes cache_creation vs cache_read tokens.
 */
function transformCodexUsage(
  usage: NonNullable<CodexEvent["usage"]>
): UnifiedUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cached_input_tokens,
  };
}

function* transformCodexEvent(raw: CodexEvent): Generator<UnifiedEvent> {
  if (raw.type === "thread.started" && raw.thread_id) {
    yield {
      type: "session.start",
      timestamp: Date.now(),
      sessionId: raw.thread_id,
      provider: "codex",
    };
    return;
  }

  if (raw.type === "item.started" && raw.item) {
    const event = transformItemStarted(raw.item);
    if (event) {
      yield event;
    }
    return;
  }

  if (raw.type === "item.completed" && raw.item) {
    yield* transformItemCompleted(raw.item);
    return;
  }

  /**
   * TurnCompletedEvent handling.
   *
   * Codex only provides usage data on turn completion.
   * No duration or cost information is available.
   *
   * Source: TurnCompletedEvent in codex-rs/exec/src/exec_events.rs
   */
  if (raw.type === "turn.completed") {
    yield {
      type: "turn.done",
      timestamp: Date.now(),
      // Codex doesn't provide these - leave undefined
      // durationMs: undefined,
      // durationApiMs: undefined,
      // totalCostUsd: undefined,
      // numTurns: undefined,
      usage: raw.usage ? transformCodexUsage(raw.usage) : undefined,
    };
    return;
  }

  if (raw.type === "error") {
    yield {
      type: "error",
      timestamp: Date.now(),
      message: raw.message ?? "Unknown error",
    };
  }
}

export async function* startCodexSession(
  content: MessageContent[],
  opts: {
    model?: string;
    workingDirectory?: string;
    reasoningLevel?: ReasoningLevel;
    oauthToken?: string;
    idToken?: string;
  }
): AsyncGenerator<UnifiedEvent> {
  const abortController = new AbortController();
  const workingDirectory = opts.workingDirectory ?? DEFAULT_WORKING_DIR;
  const model = opts.model ?? DEFAULT_CODEX_MODEL;

  // Get Codex client (may create temp CODEX_HOME for OAuth)
  // codexHome is stored in session for reuse in continue requests
  const { codex, codexHome } = await getCodexClient(
    opts.oauthToken,
    opts.idToken
  );

  // Validate reasoning level is supported for this model
  if (opts.reasoningLevel !== undefined) {
    validateReasoningLevel(model, "codex", opts.reasoningLevel);
  }

  // Map reasoning level to Codex SDK value
  const modelReasoningEffort =
    opts.reasoningLevel !== undefined
      ? (getReasoningMeta(opts.reasoningLevel).codex as ModelReasoningEffort)
      : undefined;

  // Extract text and images
  const prompt = extractText(content);
  const images = extractImages(content);

  // Prepare temp files for images
  const { paths: imagePaths, cleanup: cleanupImages } =
    await prepareImages(images);

  try {
    const thread = codex.startThread({
      model,
      modelReasoningEffort,
      workingDirectory,
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });

    // Build input: string for text-only, array for text+images
    const input =
      imagePaths.length > 0
        ? [
            { type: "text" as const, text: prompt },
            ...imagePaths.map((path) => ({
              type: "local_image" as const,
              path,
            })),
          ]
        : prompt;

    const { events } = await thread.runStreamed(input, {
      signal: abortController.signal,
    });

    for await (const event of events) {
      const raw = event as CodexEvent;

      if (raw.type === "thread.started" && raw.thread_id) {
        // Store session with codex client and codexHome for reuse
        activeSessions.set(raw.thread_id, {
          provider: "codex",
          abortController,
          threadId: raw.thread_id,
          codex,
          codexHome,
        });
      }

      for (const unified of transformCodexEvent(raw)) {
        yield unified;
      }
    }
  } finally {
    // Only cleanup images - codexHome cleanup is handled by session lifecycle
    await cleanupImages();
  }
}

export async function* continueCodexSession(
  sessionId: string,
  content: MessageContent[],
  opts?: {
    model?: string;
    reasoningLevel?: ReasoningLevel;
    oauthToken?: string;
    idToken?: string;
  }
): AsyncGenerator<UnifiedEvent> {
  const abortController = new AbortController();

  // Try to get existing session with its codex client
  const existingSession = activeSessions.get(sessionId);

  // Reuse existing codex client, or create new one if session not found
  // (session might not be found if server restarted)
  let codex: Codex;
  let codexHome: string | undefined;

  if (existingSession) {
    // Reuse the existing codex client and codexHome
    codex = existingSession.codex;
    codexHome = existingSession.codexHome;
  } else {
    // Fallback: create new client (may happen after server restart)
    const client = await getCodexClient(opts?.oauthToken, opts?.idToken);
    codex = client.codex;
    codexHome = client.codexHome;
  }

  const model = opts?.model ?? DEFAULT_CODEX_MODEL;

  // Validate and map reasoning level
  if (opts?.reasoningLevel !== undefined) {
    validateReasoningLevel(model, "codex", opts.reasoningLevel);
  }
  const modelReasoningEffort =
    opts?.reasoningLevel !== undefined
      ? (getReasoningMeta(opts.reasoningLevel).codex as ModelReasoningEffort)
      : undefined;

  // Extract text and images
  const prompt = extractText(content);
  const images = extractImages(content);

  // Prepare temp files for images
  const { paths: imagePaths, cleanup: cleanupImages } =
    await prepareImages(images);

  try {
    const thread = codex.resumeThread(sessionId, {
      model,
      modelReasoningEffort,
    });

    // Update session with new abort controller
    activeSessions.set(sessionId, {
      provider: "codex",
      abortController,
      threadId: sessionId,
      codex,
      codexHome,
    });

    // Build input: string for text-only, array for text+images
    const input =
      imagePaths.length > 0
        ? [
            { type: "text" as const, text: prompt },
            ...imagePaths.map((path) => ({
              type: "local_image" as const,
              path,
            })),
          ]
        : prompt;

    const { events } = await thread.runStreamed(input, {
      signal: abortController.signal,
    });

    for await (const event of events) {
      for (const unified of transformCodexEvent(event as CodexEvent)) {
        yield unified;
      }
    }
  } finally {
    // Only cleanup images - codexHome cleanup is handled by session lifecycle
    await cleanupImages();
  }
}

export async function interruptCodexSession(
  sessionId: string
): Promise<boolean> {
  const session = activeSessions.get(sessionId);
  if (session?.provider === "codex") {
    session.abortController.abort();
    // Cleanup temp CODEX_HOME if it exists
    await cleanupSessionCodexHome(session);
    activeSessions.delete(sessionId);
    return true;
  }
  return false;
}

export function getCodexSession(sessionId: string): ActiveSession | undefined {
  const session = activeSessions.get(sessionId);
  return session?.provider === "codex" ? session : undefined;
}
