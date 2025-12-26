import { adminDb } from "@repo/db/admin";
import { logger, metadata, schemaTask } from "@trigger.dev/sdk";
import z from "zod";

const AGENTS_SERVER_URL = "http://localhost:3001";

type ToolCallData = {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status: "running" | "completed" | "error";
};

type MessageBlockData =
  | { type: "text"; content: string }
  | { type: "tool"; tool: ToolCallData };

type UnifiedEvent = {
  type: string;
  sessionId?: string;
  content?: string;
  toolId?: string;
  name?: string;
  input?: string;
  output?: string;
  status?: string;
  message?: string;
  timestamp: number;
};

type StreamState = {
  blocks: MessageBlockData[];
  currentTextBlockIndex: number | null;
  toolBlockIndices: Map<string, number>;
  assistantMessageId: string;
};

type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mediaType: string };

async function getOAuthTokens(
  userId: string,
  provider: "claude" | "codex"
): Promise<{ accessToken?: string; idToken?: string }> {
  logger.debug("Fetching OAuth token", { userId, provider });
  const result = await adminDb.db.query({
    oauthTokens: {
      $: { where: { "user.id": userId, provider } },
    },
  });
  const token = result.oauthTokens?.[0] as
    | { accessToken?: string; idToken?: string }
    | undefined;
  const hasToken = Boolean(token?.accessToken);
  logger.info("OAuth token lookup", { userId, provider, hasToken });
  return {
    accessToken: token?.accessToken,
    idToken: token?.idToken,
  };
}

type AllTokens = {
  claude?: { accessToken: string; idToken?: string };
  github?: string;
  vercel?: string;
};

async function getAllOAuthTokens(userId: string): Promise<AllTokens> {
  logger.info("Fetching all OAuth tokens for user", { userId });
  const result = await adminDb.db.query({
    oauthTokens: {
      $: { where: { "user.id": userId } },
    },
  });

  const tokens: AllTokens = {};

  for (const token of result.oauthTokens ?? []) {
    const t = token as {
      provider?: string;
      accessToken?: string;
      idToken?: string;
    };
    if (!t.accessToken) {
      continue;
    }

    switch (t.provider) {
      case "claude":
        tokens.claude = { accessToken: t.accessToken, idToken: t.idToken };
        break;
      case "github":
        tokens.github = t.accessToken;
        break;
      case "vercel":
        tokens.vercel = t.accessToken;
        break;
      default:
        break;
    }
  }

  logger.info("OAuth tokens fetched", {
    userId,
    hasClaude: Boolean(tokens.claude),
    hasGithub: Boolean(tokens.github),
    hasVercel: Boolean(tokens.vercel),
  });

  return tokens;
}

function buildEnvFromTokens(tokens: AllTokens): Record<string, string> {
  const env: Record<string, string> = {};
  if (tokens.claude?.accessToken) {
    env.CLAUDE_CODE_OAUTH_TOKEN = tokens.claude.accessToken;
  }
  if (tokens.github) {
    env.GH_TOKEN = tokens.github;
  }
  if (tokens.vercel) {
    env.VERCEL_TOKEN = tokens.vercel;
  }
  return env;
}

async function* parseSSEStream(
  response: Response
): AsyncGenerator<UnifiedEvent> {
  const reader = response.body?.getReader();
  if (!reader) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }
      try {
        yield JSON.parse(line.slice(6)) as UnifiedEvent;
      } catch {
        // ignore
      }
    }
  }
}

function buildMessageBlocks(state: StreamState): MessageBlockData[] {
  return state.blocks.length > 0
    ? state.blocks
    : [{ type: "text", content: "" }];
}

async function syncMessage(state: StreamState) {
  const blocks = buildMessageBlocks(state);
  await adminDb.db.transact([
    adminDb.db.tx.messages[state.assistantMessageId]!.update({ blocks }),
  ]);
}

function getMediaType(url: string, contentType?: string): string {
  if (contentType) {
    return contentType;
  }
  const ext = url.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return types[ext || ""] || "image/png";
}

async function fetchImageAsBase64(
  url: string
): Promise<{ data: string; mediaType: string }> {
  logger.debug("Fetching image", { url: url.slice(0, 100) });
  const response = await fetch(url);
  const contentType = response.headers.get("content-type") || undefined;
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mediaType = getMediaType(url, contentType);
  logger.debug("Image fetched", {
    mediaType,
    sizeBytes: arrayBuffer.byteLength,
  });
  return { data: base64, mediaType };
}

type MessageBlock =
  | { type: "text"; content: string }
  | { type: "image"; fileId: string };

type FileData = { id: string; url: string };

async function getMessageContent(messageId: string): Promise<MessageContent[]> {
  logger.debug("Fetching message content", { messageId });
  const result = await adminDb.db.query({
    messages: {
      $: { where: { id: messageId } },
      files: {},
    },
  });

  const msg = result.messages?.[0] as
    | { blocks?: MessageBlock[]; files?: FileData[] }
    | undefined;
  if (!msg) {
    logger.error("User message not found", { messageId });
    throw new Error("User message not found");
  }

  const content: MessageContent[] = [];
  const blockCount = msg.blocks?.length ?? 0;
  const fileCount = msg.files?.length ?? 0;
  logger.info("Processing message blocks", {
    messageId,
    blockCount,
    fileCount,
  });

  // Process blocks
  for (const block of msg.blocks || []) {
    if (block.type === "text" && block.content) {
      content.push({ type: "text", text: block.content });
    } else if (block.type === "image") {
      const file = msg.files?.find((f) => f.id === block.fileId);
      if (file?.url) {
        const { data, mediaType } = await fetchImageAsBase64(file.url);
        content.push({ type: "image", data, mediaType });
      }
    }
  }

  const textCount = content.filter((c) => c.type === "text").length;
  const imageCount = content.filter((c) => c.type === "image").length;
  logger.info("Message content prepared", { textCount, imageCount });

  return content;
}

async function handleTextEvent(state: StreamState, event: UnifiedEvent) {
  if (!event.content) {
    return;
  }

  if (state.currentTextBlockIndex !== null) {
    // Append to existing text block
    const block = state.blocks[state.currentTextBlockIndex];
    if (block?.type === "text") {
      block.content += event.content;
    }
  } else {
    // Create new text block
    state.currentTextBlockIndex = state.blocks.length;
    state.blocks.push({ type: "text", content: event.content });
  }

  await syncMessage(state);
}

async function handleToolStart(state: StreamState, event: UnifiedEvent) {
  if (!(event.toolId && event.name)) {
    return;
  }
  logger.info("Tool started", { toolId: event.toolId, toolName: event.name });
  metadata.append("toolCalls", {
    id: event.toolId,
    name: event.name,
    status: "running",
  });

  // Tool call interrupts text streaming - next text will be a new block
  state.currentTextBlockIndex = null;

  // Add tool block
  const toolBlockIndex = state.blocks.length;
  state.toolBlockIndices.set(event.toolId, toolBlockIndex);
  state.blocks.push({
    type: "tool",
    tool: {
      id: event.toolId,
      name: event.name,
      input: event.input,
      status: "running",
    },
  });

  await syncMessage(state);
}

async function handleToolDone(state: StreamState, event: UnifiedEvent) {
  if (!event.toolId) {
    return;
  }
  const toolBlockIndex = state.toolBlockIndices.get(event.toolId);
  if (toolBlockIndex === undefined) {
    return;
  }
  const block = state.blocks[toolBlockIndex];
  if (block?.type !== "tool") {
    return;
  }

  const status = event.status === "error" ? "error" : "completed";
  logger.info("Tool completed", {
    toolId: event.toolId,
    toolName: block.tool.name,
    status,
  });

  block.tool.output = event.output;
  block.tool.status = status;

  await syncMessage(state);
}

type StreamStats = {
  eventCount: number;
  textChunks: number;
  toolsStarted: number;
  toolsCompleted: number;
  errors: number;
};

async function processSSEEvents(
  response: Response,
  assistantMessageId: string,
  onSessionId?: (id: string) => Promise<void>
) {
  logger.info("Starting SSE stream processing", { assistantMessageId });
  metadata.set("streamStatus", "streaming");

  const state: StreamState = {
    blocks: [],
    currentTextBlockIndex: null,
    toolBlockIndices: new Map(),
    assistantMessageId,
  };

  const stats: StreamStats = {
    eventCount: 0,
    textChunks: 0,
    toolsStarted: 0,
    toolsCompleted: 0,
    errors: 0,
  };

  for await (const event of parseSSEStream(response)) {
    stats.eventCount++;

    switch (event.type) {
      case "session.start":
        logger.info("Agent session started", {
          agentSessionId: event.sessionId,
        });
        if (event.sessionId && onSessionId) {
          await onSessionId(event.sessionId);
        }
        break;
      case "text":
        stats.textChunks++;
        await handleTextEvent(state, event);
        break;
      case "tool.start":
        stats.toolsStarted++;
        await handleToolStart(state, event);
        break;
      case "tool.done":
        stats.toolsCompleted++;
        await handleToolDone(state, event);
        break;
      case "error":
        stats.errors++;
        logger.error("Agent error", { message: event.message });
        break;
      default:
        logger.debug("Unknown event type", { eventType: event.type });
        break;
    }
  }

  metadata.set("streamStatus", "completed");
  metadata.set("streamStats", stats);

  // Calculate final stats from blocks
  const textBlocks = state.blocks.filter((b) => b.type === "text");
  const totalTextLength = textBlocks.reduce(
    (sum, b) => sum + (b.type === "text" ? b.content.length : 0),
    0
  );

  logger.info("SSE stream completed", {
    ...stats,
    totalBlocks: state.blocks.length,
    finalTextLength: totalTextLength,
    totalToolCalls: state.toolBlockIndices.size,
  });
}

export const createSession = schemaTask({
  id: "create-session",
  description: "Create a new agent session and stream response",
  schema: z.object({
    sessionId: z.string(),
    messageId: z.string(),
    assistantMessageId: z.string(),
    userId: z.string(),
    provider: z.enum(["claude", "codex"]),
    model: z.string(),
    reasoningLevel: z.number().int().min(0).max(4),
  }),
  run: async ({
    sessionId,
    messageId,
    assistantMessageId,
    userId,
    provider,
    model,
    reasoningLevel,
  }) => {
    const startTime = Date.now();
    const { db } = adminDb;

    // Initialize metadata for tracking
    metadata.set("sessionId", sessionId);
    metadata.set("userId", userId);
    metadata.set("taskType", "create-session");
    metadata.set("status", "initializing");

    logger.info("Creating new session", {
      sessionId,
      messageId,
      assistantMessageId,
      userId,
      provider,
      model,
      reasoningLevel,
    });

    // Fetch message content
    metadata.set("status", "fetching-content");
    const content = await getMessageContent(messageId);
    const textContent = content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join(" ");
    const preview =
      textContent.slice(0, 100) + (textContent.length > 100 ? "..." : "");
    metadata.set("messagePreview", preview);

    // Fetch OAuth tokens
    metadata.set("status", "fetching-oauth");
    const { accessToken: oauthToken, idToken } = await getOAuthTokens(
      userId,
      provider
    );
    metadata.set("hasOAuthToken", Boolean(oauthToken));

    // Call agents-server
    metadata.set("status", "calling-agent");
    logger.info("Calling agents-server", {
      url: `${AGENTS_SERVER_URL}/sessions`,
      provider,
      model,
      reasoningLevel,
      contentItems: content.length,
      hasOAuthToken: Boolean(oauthToken),
    });

    const response = await fetch(`${AGENTS_SERVER_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        content,
        model,
        reasoningLevel,
        ...(oauthToken && { oauthToken }),
        ...(idToken && { idToken }),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      logger.error("Agent server request failed", {
        status: response.status,
        statusText: response.statusText,
        error: errorText.slice(0, 500),
      });
      metadata.set("status", "error");
      metadata.set("error", `Agent server error: ${response.status}`);
      throw new Error(
        `Agent server error: ${response.status} - ${errorText.slice(0, 200)}`
      );
    }

    logger.info("Agent server connected", { status: response.status });

    let agentSessionId: string | undefined;

    await processSSEEvents(response, assistantMessageId, async (id) => {
      agentSessionId = id;
      metadata.set("agentSessionId", id);
      await db.transact([
        db.tx.sessions[sessionId]!.update({ agentSessionId }),
      ]);
    });

    // Update session status
    metadata.set("status", "finalizing");
    await db.transact([
      db.tx.sessions[sessionId]!.update({
        status: "idle",
        updatedAt: new Date(),
      }),
    ]);

    const durationMs = Date.now() - startTime;
    metadata.set("status", "completed");
    metadata.set("durationMs", durationMs);

    logger.info("Session created successfully", {
      sessionId,
      agentSessionId,
      durationMs,
    });

    return {
      agentSessionId,
      sessionId,
      durationMs,
      messagePreview: preview,
    };
  },
});

export const continueSession = schemaTask({
  id: "continue-session",
  description: "Continue an existing agent session",
  schema: z.object({
    sessionId: z.string(),
    messageId: z.string(),
    assistantMessageId: z.string(),
    userId: z.string(),
    provider: z.enum(["claude", "codex"]),
    model: z.string(),
    reasoningLevel: z.number().int().min(0).max(4),
  }),
  run: async ({
    sessionId,
    messageId,
    assistantMessageId,
    userId,
    provider,
    model,
    reasoningLevel,
  }) => {
    const startTime = Date.now();
    const { db } = adminDb;

    // Initialize metadata for tracking
    metadata.set("sessionId", sessionId);
    metadata.set("userId", userId);
    metadata.set("taskType", "continue-session");
    metadata.set("status", "initializing");

    logger.info("Continuing session", {
      sessionId,
      messageId,
      assistantMessageId,
      userId,
      provider,
      model,
      reasoningLevel,
    });

    // Fetch session to get agentSessionId
    metadata.set("status", "fetching-session");
    const sessionResult = await db.query({
      sessions: { $: { where: { id: sessionId } } },
    });
    const session = sessionResult.sessions?.[0];

    if (!session?.agentSessionId) {
      logger.error("Session not found or missing agentSessionId", {
        sessionId,
        sessionExists: Boolean(session),
      });
      metadata.set("status", "error");
      metadata.set("error", "Session not found");
      throw new Error("Session not found or missing agentSessionId");
    }

    const agentSessionId = session.agentSessionId as string;
    metadata.set("agentSessionId", agentSessionId);
    logger.info("Found agent session", {
      agentSessionId,
      model,
      reasoningLevel,
    });

    // Fetch message content
    metadata.set("status", "fetching-content");
    const content = await getMessageContent(messageId);
    const textContent = content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join(" ");
    const preview =
      textContent.slice(0, 100) + (textContent.length > 100 ? "..." : "");
    metadata.set("messagePreview", preview);

    // Fetch OAuth tokens
    metadata.set("status", "fetching-oauth");
    const { accessToken: oauthToken, idToken } = await getOAuthTokens(
      userId,
      provider
    );
    metadata.set("hasOAuthToken", Boolean(oauthToken));

    // Call agents-server continue endpoint
    metadata.set("status", "calling-agent");
    const continueUrl = `${AGENTS_SERVER_URL}/sessions/${agentSessionId}/continue`;
    logger.info("Calling agents-server continue", {
      url: continueUrl,
      agentSessionId,
      model,
      reasoningLevel,
      contentItems: content.length,
      hasOAuthToken: Boolean(oauthToken),
    });

    const response = await fetch(continueUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        content,
        model,
        reasoningLevel,
        workingDirectory: "/root",
        ...(oauthToken && { oauthToken }),
        ...(idToken && { idToken }),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      logger.error("Agent server request failed", {
        status: response.status,
        statusText: response.statusText,
        error: errorText.slice(0, 500),
      });
      metadata.set("status", "error");
      metadata.set("error", `Agent server error: ${response.status}`);
      throw new Error(
        `Agent server error: ${response.status} - ${errorText.slice(0, 200)}`
      );
    }

    logger.info("Agent server connected", { status: response.status });

    await processSSEEvents(response, assistantMessageId);

    // Update session status
    metadata.set("status", "finalizing");
    await db.transact([
      db.tx.sessions[sessionId]!.update({
        status: "idle",
        updatedAt: new Date(),
      }),
    ]);

    const durationMs = Date.now() - startTime;
    metadata.set("status", "completed");
    metadata.set("durationMs", durationMs);

    logger.info("Session continued successfully", {
      sessionId,
      agentSessionId,
      durationMs,
    });

    return {
      success: true,
      sessionId,
      agentSessionId,
      durationMs,
      messagePreview: preview,
    };
  },
});

type SessionEnv = {
  env: Record<string, string>;
  oauthToken?: string;
};

async function buildSessionEnv(
  userId?: string,
  inputOauthToken?: string
): Promise<SessionEnv> {
  if (!userId) {
    return { env: {}, oauthToken: inputOauthToken };
  }

  const allTokens = await getAllOAuthTokens(userId);
  const env = buildEnvFromTokens(allTokens);

  // Add SWITCHBOARD_USER_ID so operator-cli can auto-detect user
  env.SWITCHBOARD_USER_ID = userId;

  const oauthToken = inputOauthToken ?? allTokens.claude?.accessToken;

  logger.info("Built session env from user tokens", {
    userId,
    envKeys: Object.keys(env),
    hasOauthToken: Boolean(oauthToken),
  });

  return { env, oauthToken };
}

type TokenResolution = {
  token?: string;
  source: "direct" | "userId-lookup" | "none";
};

async function _resolveOAuthToken(
  provider: "claude" | "codex",
  inputToken?: string,
  userId?: string
): Promise<TokenResolution> {
  if (inputToken) {
    return { token: inputToken, source: "direct" };
  }

  if (!userId) {
    return { token: undefined, source: "none" };
  }

  logger.info("Fetching OAuth token for user", { userId, provider });
  const { accessToken } = await getOAuthTokens(userId, provider);

  if (accessToken) {
    logger.info("Found OAuth token via userId lookup", {
      userId,
      provider,
      tokenLength: accessToken.length,
    });
    return { token: accessToken, source: "userId-lookup" };
  }

  logger.warn("No OAuth token found for user", { userId, provider });
  return { token: undefined, source: "none" };
}

export const babyCanvasSend = schemaTask({
  id: "baby-canvas-send",
  description: "Send a one-off message to the agents server on Fly",
  schema: z.object({
    machineIp: z.string(),
    message: z.string().min(1),
    agentSessionId: z.string().optional(),
    provider: z.enum(["claude", "codex"]),
    model: z.string(),
    reasoningLevel: z.number().int().min(0).max(4),
    oauthToken: z.string().optional(),
    userId: z.string().optional(), // Fetch OAuth tokens for this user
  }),
  run: async ({
    machineIp,
    message,
    agentSessionId: inputSessionId,
    provider,
    model,
    reasoningLevel,
    oauthToken: inputOauthToken,
    userId,
  }) => {
    const { env, oauthToken } = await buildSessionEnv(userId, inputOauthToken);
    const isNewSession = !inputSessionId;
    const url = inputSessionId
      ? `http://[${machineIp}]:42070/sessions/${inputSessionId}/continue`
      : `http://[${machineIp}]:42070/sessions`;

    logger.info("Sending message to agents server", {
      url,
      isNewSession,
      provider,
      model,
      envKeys: Object.keys(env),
    });

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        content: [{ type: "text", text: message } satisfies MessageContent],
        model,
        reasoningLevel,
        workingDirectory: "/root",
        ...(oauthToken && { oauthToken }),
        ...(Object.keys(env).length > 0 && { env }),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Agent server error: ${response.status} - ${errorText.slice(0, 200)}`
      );
    }

    // Process stream and capture session ID from session.start event
    let capturedSessionId: string | undefined;
    for await (const event of parseSSEStream(response)) {
      if (event.type === "session.start" && event.sessionId) {
        capturedSessionId = event.sessionId;
        logger.info("Captured session ID", {
          sessionId: capturedSessionId,
          isNewSession,
          inputSessionId,
        });

        // If we're continuing but got a different session ID, the resume failed
        if (!isNewSession && capturedSessionId !== inputSessionId) {
          logger.warn("Resume created new session instead of continuing", {
            expected: inputSessionId,
            got: capturedSessionId,
          });
        }
      }
    }

    // For continue operations, always use the input session ID
    // For new sessions, use the captured one
    const finalSessionId = isNewSession ? capturedSessionId : inputSessionId;
    logger.info("Message sent successfully", {
      sessionId: finalSessionId,
      isNewSession,
    });

    return { success: true, sessionId: finalSessionId };
  },
});
