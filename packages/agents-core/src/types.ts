import type { ReasoningLevel } from "./models";
import type { Provider } from "./provider";

// ============================================================================
// Message Content Types
// ============================================================================

/**
 * Text content block for messages.
 */
export type TextContent = {
  type: "text";
  text: string;
};

/**
 * Image content block for messages.
 * Images are sent as base64-encoded data with a media type.
 *
 * Supported media types:
 * - image/png
 * - image/jpeg
 * - image/gif
 * - image/webp
 */
export type ImageContent = {
  type: "image";
  /** Base64-encoded image data */
  data: string;
  /** MIME type of the image (e.g., "image/png", "image/jpeg") */
  mediaType: string;
};

/**
 * Union of all content block types that can be included in a message.
 */
export type MessageContent = TextContent | ImageContent;

/**
 * Extract text content from message content array.
 */
export function extractText(content: MessageContent[]): string {
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n\n");
}

/**
 * Extract image content from message content array.
 */
export function extractImages(content: MessageContent[]): ImageContent[] {
  return content.filter((c): c is ImageContent => c.type === "image");
}

// ============================================================================
// Request Types
// ============================================================================

export type StartSessionRequest = {
  provider: Provider;
  content: MessageContent[];
  model?: string;
  workingDirectory?: string;
  reasoningLevel?: ReasoningLevel;
  /** OAuth access token for Claude Max authentication (alternative to API key) */
  oauthToken?: string;
};

export type ContinueSessionRequest = {
  content: MessageContent[];
  /** OAuth access token for Claude Max authentication (alternative to API key) */
  oauthToken?: string;
};

// ============================================================================
// Unified Event Types
// ============================================================================

/*
 * These types provide a normalized interface over Claude Agent SDK and Codex SDK
 * events for client consumption. Each provider has different levels of data richness:
 *
 * ## Data Sources
 *
 * **Claude Agent SDK** (rich timing/cost data):
 * - Reference: docs/claude-agents-sdk/agent-sdk-reference.md
 * - `SDKResultMessage` provides: duration_ms, duration_api_ms, total_cost_usd,
 *   num_turns, usage (input_tokens, output_tokens, cache tokens)
 * - `SDKAssistantMessage` and `SDKUserMessage` provide tool use/result blocks
 *
 * **Codex SDK** (minimal timing data):
 * - Source: https://github.com/openai/codex (codex-rs/exec/src/exec_events.rs)
 * - `TurnCompletedEvent` provides only: usage (input_tokens, cached_input_tokens,
 *   output_tokens)
 * - No duration or cost fields available in events or items
 *
 * ## Design Decisions
 *
 * 1. All events include `timestamp` (Date.now()) to enable client-side duration
 *    calculation between tool.start and tool.done events.
 *
 * 2. `TurnDoneEvent` includes optional fields for rich data - Claude populates
 *    most fields, Codex only populates `usage`.
 *
 * 3. Per-tool duration is NOT provided by either SDK. Clients can compute it
 *    from timestamps if needed.
 */

/**
 * Token usage statistics.
 *
 * Available from both SDKs:
 * - Claude: `SDKResultMessage.usage` (NonNullableUsage type)
 * - Codex: `TurnCompletedEvent.usage` (Usage type from events.ts)
 *
 * Cache token fields are optional as Codex uses `cachedInputTokens` (single field)
 * while Claude distinguishes `cacheCreationInputTokens` and `cacheReadInputTokens`.
 */
export type UnifiedUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Codex: cachedInputTokens. Claude: not provided separately. */
  cachedInputTokens?: number;
  /** Claude only: tokens used to create new cache entries */
  cacheCreationInputTokens?: number;
  /** Claude only: tokens read from existing cache */
  cacheReadInputTokens?: number;
};

/**
 * Emitted when a new session is established.
 * - Claude: from `SDKSystemMessage` with subtype "init"
 * - Codex: from `ThreadStartedEvent`
 */
export type SessionStartEvent = {
  type: "session.start";
  /** Unix timestamp (ms) when this event was emitted */
  timestamp: number;
  sessionId: string;
  provider: Provider;
};

/**
 * Emitted when the agent produces text output.
 * - Claude: from `SDKAssistantMessage` text content blocks
 * - Codex: from `AgentMessageItem` in item.completed events
 */
export type TextEvent = {
  type: "text";
  /** Unix timestamp (ms) when this event was emitted */
  timestamp: number;
  content: string;
};

/**
 * Emitted when a tool execution begins.
 * - Claude: from `SDKAssistantMessage` tool_use content blocks
 * - Codex: from `ItemStartedEvent` with CommandExecutionItem
 *
 * Note: Neither SDK provides per-tool timing. Use timestamp diff between
 * tool.start and tool.done to calculate duration client-side.
 */
export type ToolStartEvent = {
  type: "tool.start";
  /** Unix timestamp (ms) when this event was emitted */
  timestamp: number;
  toolId: string;
  name: string;
  input?: string;
};

/**
 * Emitted when a tool execution completes.
 * - Claude: from `SDKUserMessage` tool_result content blocks
 * - Codex: from `ItemCompletedEvent` with CommandExecutionItem
 */
export type ToolDoneEvent = {
  type: "tool.done";
  /** Unix timestamp (ms) when this event was emitted */
  timestamp: number;
  toolId: string;
  output: string;
  status: "completed" | "error";
};

/**
 * Emitted when an agent turn completes.
 *
 * ## Data Availability by Provider
 *
 * | Field           | Claude | Codex | Source                          |
 * |-----------------|--------|-------|---------------------------------|
 * | durationMs      | yes    | no    | SDKResultMessage.duration_ms    |
 * | durationApiMs   | yes    | no    | SDKResultMessage.duration_api_ms|
 * | totalCostUsd    | yes    | no    | SDKResultMessage.total_cost_usd |
 * | numTurns        | yes    | no    | SDKResultMessage.num_turns      |
 * | usage           | yes    | yes   | Both provide token counts       |
 *
 * Claude source: SDKResultMessage in agent-sdk-reference.md
 * Codex source: TurnCompletedEvent in codex-rs/exec/src/exec_events.rs
 */
export type TurnDoneEvent = {
  type: "turn.done";
  /** Unix timestamp (ms) when this event was emitted */
  timestamp: number;
  /**
   * Total duration of the turn in milliseconds.
   * Claude only - from SDKResultMessage.duration_ms
   */
  durationMs?: number;
  /**
   * Time spent in API calls in milliseconds.
   * Claude only - from SDKResultMessage.duration_api_ms
   */
  durationApiMs?: number;
  /**
   * Total cost of the turn in USD.
   * Claude only - from SDKResultMessage.total_cost_usd
   */
  totalCostUsd?: number;
  /**
   * Number of conversation turns.
   * Claude only - from SDKResultMessage.num_turns
   */
  numTurns?: number;
  /**
   * Token usage statistics.
   * Available from both providers with slightly different cache token semantics.
   */
  usage?: UnifiedUsage;
};

/**
 * Emitted when an error occurs.
 * - Claude: from SDKResultMessage with subtype "error_*"
 * - Codex: from ThreadErrorEvent or TurnFailedEvent
 */
export type ErrorEvent = {
  type: "error";
  /** Unix timestamp (ms) when this event was emitted */
  timestamp: number;
  message: string;
};

export type UnifiedEvent =
  | SessionStartEvent
  | TextEvent
  | ToolStartEvent
  | ToolDoneEvent
  | TurnDoneEvent
  | ErrorEvent;

// ============================================================================
// Shared Types
// ============================================================================

export type Attachment = {
  id: string;
  file: File;
  previewUrl: string;
  base64: string;
  mediaType: string;
  uploadStatus: "uploading" | "uploaded" | "error";
  fileId?: string;
};

export type ToolCall = {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status: "running" | "completed" | "error";
};

export type MessageBlock =
  | { type: "text"; content: string }
  | { type: "image"; fileId: string }
  | { type: "tool"; tool: ToolCall };

export type Message = {
  id: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
};

export type SessionStatus = "idle" | "streaming";
