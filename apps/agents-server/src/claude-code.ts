import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  DEFAULT_CLAUDE_MODEL,
  getReasoningMeta,
  type ReasoningLevel,
  validateReasoningLevel,
} from "./models";
import {
  type ActiveSession,
  extractImages,
  extractText,
  type MessageContent,
  type UnifiedEvent,
  type UnifiedUsage,
} from "./types";

const activeSessions = new Map<string, ActiveSession>();

type ContentBlock = {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  content?: string | unknown;
  tool_use_id?: string;
};

/**
 * Claude SDK message types.
 *
 * Reference: docs/claude-agents-sdk/agent-sdk-reference.md
 *
 * Key message types we handle:
 * - SDKSystemMessage (type: "system", subtype: "init"): Session initialization
 * - SDKAssistantMessage (type: "assistant"): Text and tool_use blocks
 * - SDKUserMessage (type: "user"): Tool results
 * - SDKResultMessage (type: "result"): Turn completion with rich metrics
 */
type ClaudeMessage = {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    content?: ContentBlock[];
  };
  /**
   * SDKResultMessage fields - available when type === "result"
   * See: SDKResultMessage in agent-sdk-reference.md
   */
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  num_turns?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

function* transformAssistantBlocks(
  blocks: ContentBlock[]
): Generator<UnifiedEvent> {
  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      yield { type: "text", timestamp: Date.now(), content: block.text };
    } else if (block.type === "tool_use" && block.name && block.id) {
      yield {
        type: "tool.start",
        timestamp: Date.now(),
        toolId: block.id,
        name: block.name,
        input: block.input ? JSON.stringify(block.input, null, 2) : undefined,
      };
    }
  }
}

function* transformToolResultBlocks(
  blocks: ContentBlock[]
): Generator<UnifiedEvent> {
  for (const block of blocks) {
    if (block.type === "tool_result") {
      const toolId = block.tool_use_id || block.id;
      if (toolId) {
        const output =
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
        yield {
          type: "tool.done",
          timestamp: Date.now(),
          toolId,
          output,
          status: "completed",
        };
      }
    }
  }
}

/**
 * Transform Claude SDK usage to unified format.
 *
 * Claude provides:
 * - input_tokens, output_tokens (always)
 * - cache_creation_input_tokens, cache_read_input_tokens (optional)
 *
 * Note: Claude doesn't have a single "cached_input_tokens" field like Codex.
 * We leave cachedInputTokens undefined for Claude events.
 */
function transformClaudeUsage(
  usage: NonNullable<ClaudeMessage["usage"]>
): UnifiedUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens,
  };
}

function* transformClaudeEvent(raw: ClaudeMessage): Generator<UnifiedEvent> {
  if (raw.type === "system" && raw.subtype === "init" && raw.session_id) {
    yield {
      type: "session.start",
      timestamp: Date.now(),
      sessionId: raw.session_id,
      provider: "claude",
    };
    return;
  }

  if (raw.type === "assistant" && raw.message?.content) {
    yield* transformAssistantBlocks(raw.message.content);
    return;
  }

  if (raw.type === "user" && raw.message?.content) {
    yield* transformToolResultBlocks(raw.message.content);
    return;
  }

  /**
   * SDKResultMessage handling.
   *
   * Extract rich metrics from Claude's result message:
   * - duration_ms: Total turn duration
   * - duration_api_ms: Time spent in API calls
   * - total_cost_usd: Cost in USD
   * - num_turns: Number of conversation turns
   * - usage: Token usage statistics
   *
   * Reference: SDKResultMessage in docs/claude-agents-sdk/agent-sdk-reference.md
   */
  if (raw.type === "result") {
    yield {
      type: "turn.done",
      timestamp: Date.now(),
      durationMs: raw.duration_ms,
      durationApiMs: raw.duration_api_ms,
      totalCostUsd: raw.total_cost_usd,
      numTurns: raw.num_turns,
      usage: raw.usage ? transformClaudeUsage(raw.usage) : undefined,
    };
  }
}

const DEFAULT_WORKING_DIR = process.env.DEFAULT_WORKING_DIR ?? process.cwd();

/**
 * Claude SDK content block types for user messages.
 * Reference: streaming-vs-single-mode.md
 */
type ClaudeTextBlock = {
  type: "text";
  text: string;
};

type ClaudeImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
};

type ClaudeContentBlock = ClaudeTextBlock | ClaudeImageBlock;

/**
 * Claude SDK user message format for streaming input mode.
 * Matches SDKUserMessage from the SDK.
 */
type ClaudeUserMessage = {
  type: "user";
  message: {
    role: "user";
    content: string | ClaudeContentBlock[];
  };
  session_id: string;
  parent_tool_use_id: string | null;
};

/**
 * Convert our MessageContent to Claude's content block format.
 */
function toClaudeContentBlocks(
  content: MessageContent[]
): ClaudeContentBlock[] {
  return content.map((c): ClaudeContentBlock => {
    if (c.type === "text") {
      return { type: "text", text: c.text };
    }
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: c.mediaType,
        data: c.data,
      },
    };
  });
}

/**
 * Create a Claude user message from our content array.
 * Uses simple string for text-only, content blocks for mixed content.
 */
function toClaudeUserMessage(content: MessageContent[]): ClaudeUserMessage {
  const images = extractImages(content);

  if (images.length === 0) {
    // Text-only: use simple string format
    return {
      type: "user",
      message: {
        role: "user",
        content: extractText(content),
      },
      session_id: "", // Will be set by SDK
      parent_tool_use_id: null,
    };
  }

  // Has images: use content blocks format
  return {
    type: "user",
    message: {
      role: "user",
      content: toClaudeContentBlocks(content),
    },
    session_id: "", // Will be set by SDK
    parent_tool_use_id: null,
  };
}

/**
 * Create an async generator that yields a single user message.
 * Required for Claude's streaming input mode which supports images.
 */
// biome-ignore lint/suspicious/useAwait: async required for AsyncGenerator type expected by SDK
async function* createMessageGenerator(
  content: MessageContent[]
): AsyncGenerator<ClaudeUserMessage> {
  yield toClaudeUserMessage(content);
}

/**
 * Calculate max thinking tokens from reasoning level.
 */
function getMaxThinkingTokens(
  model: string,
  reasoningLevel?: ReasoningLevel
): number | undefined {
  if (reasoningLevel === undefined) {
    return;
  }
  validateReasoningLevel(model, "claude", reasoningLevel);
  return reasoningLevel > 0
    ? getReasoningMeta(reasoningLevel).claudeTokens
    : undefined;
}

export async function* startClaudeSession(
  content: MessageContent[],
  opts: {
    model?: string;
    workingDirectory?: string;
    reasoningLevel?: ReasoningLevel;
    oauthToken?: string;
    env?: Record<string, string>;
  }
): AsyncGenerator<UnifiedEvent> {
  const abortController = new AbortController();
  const cwd = opts.workingDirectory ?? DEFAULT_WORKING_DIR;
  const model = opts.model ?? DEFAULT_CLAUDE_MODEL;
  const maxThinkingTokens = getMaxThinkingTokens(model, opts.reasoningLevel);

  const images = extractImages(content);
  const prompt =
    images.length > 0 ? createMessageGenerator(content) : extractText(content);

  const response = query({
    prompt,
    options: {
      abortController,
      cwd,
      model,
      maxThinkingTokens,
      permissionMode: "bypassPermissions",
      env: {
        ...process.env,
        IS_SANDBOX: "true",
        ...(opts.oauthToken && { CLAUDE_CODE_OAUTH_TOKEN: opts.oauthToken }),
        ...opts.env,
      },
    },
  });

  let sessionId: string | null = null;

  for await (const message of response) {
    const raw = message as ClaudeMessage;

    if (raw.type === "system" && raw.subtype === "init" && raw.session_id) {
      sessionId = raw.session_id;
      activeSessions.set(sessionId, {
        provider: "claude",
        abortController,
      });
    }

    for (const event of transformClaudeEvent(raw)) {
      yield event;
    }
  }
}

export async function* continueClaudeSession(
  sessionId: string,
  content: MessageContent[],
  opts: {
    model?: string;
    workingDirectory?: string;
    reasoningLevel?: ReasoningLevel;
    oauthToken?: string;
    env?: Record<string, string>;
  } = {}
): AsyncGenerator<UnifiedEvent> {
  const abortController = new AbortController();
  const cwd = opts.workingDirectory ?? DEFAULT_WORKING_DIR;

  console.log("[continueClaudeSession]", {
    sessionId,
    cwd,
    optsWorkingDirectory: opts.workingDirectory,
    defaultWorkingDir: DEFAULT_WORKING_DIR,
  });

  activeSessions.set(sessionId, {
    provider: "claude",
    abortController,
  });

  const images = extractImages(content);
  const model = opts.model ?? DEFAULT_CLAUDE_MODEL;
  const maxThinkingTokens = getMaxThinkingTokens(model, opts.reasoningLevel);

  // Use streaming input mode (async generator) when we have images,
  // otherwise use simple string prompt
  const prompt =
    images.length > 0 ? createMessageGenerator(content) : extractText(content);

  const response = query({
    prompt,
    options: {
      abortController,
      cwd,
      resume: sessionId,
      model,
      maxThinkingTokens,
      permissionMode: "bypassPermissions",
      env: {
        ...process.env,
        IS_SANDBOX: "true",
        ...(opts.oauthToken && { CLAUDE_CODE_OAUTH_TOKEN: opts.oauthToken }),
        ...opts.env,
      },
    },
  });

  for await (const message of response) {
    for (const event of transformClaudeEvent(message as ClaudeMessage)) {
      yield event;
    }
  }
}

export function interruptClaudeSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (session?.provider === "claude") {
    session.abortController.abort();
    activeSessions.delete(sessionId);
    return true;
  }
  return false;
}

export function getClaudeSession(sessionId: string): ActiveSession | undefined {
  const session = activeSessions.get(sessionId);
  return session?.provider === "claude" ? session : undefined;
}
