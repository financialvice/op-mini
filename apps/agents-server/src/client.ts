import { treaty } from "@elysiajs/eden";
import type {
  MessageContent,
  Provider,
  ReasoningLevel,
  UnifiedEvent,
} from "@repo/agents-core";
import type { Attachment } from "@repo/agents-core/types";
import type { App } from "./index";

// ============================================================================
// Agent Client
// ============================================================================

export const agents = treaty<App>("localhost:3001");

// ============================================================================
// SSE Helpers
// ============================================================================

export function parseSSELine(line: string): UnifiedEvent | null {
  if (!line.startsWith("data: ")) {
    return null;
  }
  try {
    return JSON.parse(line.slice(6)) as UnifiedEvent;
  } catch {
    return null;
  }
}

export async function readSSEStream(
  response: Response,
  onEvent: (event: UnifiedEvent) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  while (!done) {
    const result = await reader.read();
    done = result.done;

    if (result.value) {
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const event = parseSSELine(line);
        if (event) {
          onEvent(event);
        }
      }
    }
  }
}

// ============================================================================
// Request Builder
// ============================================================================

export function buildAgentRequest(opts: {
  agentSessionId: string | null;
  provider: Provider;
  model: string;
  reasoningLevel: ReasoningLevel;
  text: string;
  attachments: Attachment[];
  oauthToken?: string;
}): { url: string; body: Record<string, unknown> } {
  const {
    agentSessionId,
    provider,
    model,
    reasoningLevel,
    text,
    attachments,
    oauthToken,
  } = opts;

  // Build content array with text and images
  const content: MessageContent[] = [
    { type: "text", text },
    ...attachments.map((img) => ({
      type: "image" as const,
      data: img.base64,
      mediaType: img.mediaType,
    })),
  ];

  if (agentSessionId) {
    return {
      url: `http://localhost:3001/sessions/${agentSessionId}/continue`,
      body: { content, ...(oauthToken && { oauthToken }) },
    };
  }

  return {
    url: "http://localhost:3001/sessions",
    body: {
      provider,
      content,
      model,
      reasoningLevel,
      ...(oauthToken && { oauthToken }),
    },
  };
}
