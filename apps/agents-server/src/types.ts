// Re-export shared types from @repo/agents-core
export type { Provider } from "@repo/agents-core";
export type {
  ContinueSessionRequest,
  ErrorEvent,
  ImageContent,
  MessageContent,
  SessionStartEvent,
  StartSessionRequest,
  TextContent,
  TextEvent,
  ToolDoneEvent,
  ToolStartEvent,
  TurnDoneEvent,
  UnifiedEvent,
  UnifiedUsage,
} from "@repo/agents-core/types";
export { extractImages, extractText } from "@repo/agents-core/types";

// Server-specific types (not shared with clients)
import type { Provider } from "@repo/agents-core";

export type ActiveSession = {
  provider: Provider;
  abortController: AbortController;
};

export type RawAgentEvent = {
  type: string;
  sessionId?: string;
  [key: string]: unknown;
};
