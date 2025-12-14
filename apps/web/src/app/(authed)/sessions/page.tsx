"use client";

import { id, type TransactionChunk } from "@instantdb/react";
import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  getSupportedReasoningLevels,
  type Provider,
  REASONING_LEVEL_META,
  type ReasoningLevel,
} from "@repo/agents-core";
import { type AppSchema, db } from "@repo/db";
import { useTRPC } from "@repo/trpc/client";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { Brain, ImageIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type MessageBlock =
  | { type: "text"; content: string }
  | { type: "image"; fileId: string }
  | {
      type: "tool";
      tool: {
        id: string;
        name: string;
        input?: string;
        output?: string;
        status: "running" | "completed" | "error";
      };
    };

type FileData = {
  id: string;
  path: string;
  url: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
  order: number;
  createdAt: Date;
  files?: FileData[];
};

type Session = {
  id: string;
  provider: string;
  model: string;
  status?: string;
  createdAt: Date;
  messages: Message[];
};

type PendingImage = {
  id: string;
  previewUrl: string;
  uploadPromise: Promise<{ fileId: string }>;
  fileId?: string;
  uploadComplete: boolean;
};

function getStatusColor(status: "running" | "completed" | "error"): string {
  if (status === "running") {
    return "text-yellow-500";
  }
  if (status === "error") {
    return "text-red-500";
  }
  return "text-green-500";
}

export default function SessionsPage() {
  const trpc = useTRPC();
  const { user } = db._client.useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  // Separate ID for pending uploads before session is created
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<Provider>("claude");
  const [selectedModel, setSelectedModel] = useState("haiku");
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(1);

  const { data } = db._client.useQuery(
    user
      ? {
          sessions: {
            $: { where: { "user.id": user.id }, order: { createdAt: "desc" } },
            messages: { files: {} },
          },
        }
      : null
  );

  const sessions = (data?.sessions ?? []) as Session[];
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const messages = selectedSession?.messages
    ? [...selectedSession.messages].sort((a, b) => a.order - b.order)
    : [];

  // Sync provider/model/reasoning from selected session
  useEffect(() => {
    if (selectedSession) {
      setSelectedProvider(selectedSession.provider as Provider);
      setSelectedModel(selectedSession.model);
      setReasoningLevel(
        ((selectedSession as { reasoningLevel?: number })
          .reasoningLevel as ReasoningLevel) ?? 1
      );
    } else {
      setSelectedProvider("claude");
      setSelectedModel("haiku");
      setReasoningLevel(1);
    }
  }, [selectedSession]);

  const supportedLevels = getSupportedReasoningLevels(
    selectedModel,
    selectedProvider
  );

  const cycleReasoningLevel = () => {
    const currentIdx = supportedLevels.indexOf(reasoningLevel);
    const nextIdx = (currentIdx + 1) % supportedLevels.length;
    setReasoningLevel(supportedLevels[nextIdx]!);
  };

  const handleModelChange = (value: string) => {
    const [provider, model] = value.split(":") as [Provider, string];
    // Lock provider after session starts
    if (selectedSession && provider !== selectedProvider) {
      return;
    }
    setSelectedProvider(provider);
    setSelectedModel(model);
    // Adjust reasoning level if not supported
    const levels = getSupportedReasoningLevels(model, provider);
    if (!levels.includes(reasoningLevel)) {
      const nearest = levels.reduce((a, b) =>
        Math.abs(b - reasoningLevel) < Math.abs(a - reasoningLevel) ? b : a
      );
      setReasoningLevel(nearest);
    }
  };

  const { mutateAsync: sendMessage, isPending } = useMutation(
    trpc.sessions.send.mutationOptions()
  );

  const handleNewSession = () => {
    setSelectedSessionId(null);
    setPendingSessionId(null);
    setPendingImages([]);
  };

  const handleDeleteSession = async (sessionIdToDelete: string) => {
    // If deleting the selected session, clear selection
    if (selectedSessionId === sessionIdToDelete) {
      setSelectedSessionId(null);
    }

    // Delete session and its messages
    const session = sessions.find((s) => s.id === sessionIdToDelete);
    const messageTxns =
      session?.messages?.map((msg) =>
        db._client.tx.messages[msg.id]!.delete()
      ) ?? [];

    await db._client.transact([
      ...messageTxns,
      db._client.tx.sessions[sessionIdToDelete]!.delete(),
    ]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) {
      return;
    }

    // Use existing sessionId, pending sessionId, or generate one for uploads
    const sessionId = selectedSessionId ?? pendingSessionId ?? id();
    if (!(selectedSessionId || pendingSessionId)) {
      setPendingSessionId(sessionId);
    }

    const newImages: PendingImage[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        continue;
      }
      const imageId = id();
      const path = `sessions/${sessionId}/${imageId}-${file.name}`;

      // Start upload immediately
      const uploadPromise = db._client.storage
        .uploadFile(path, file)
        .then((result) => {
          // Update state when upload completes
          setPendingImages((prev) =>
            prev.map((img) =>
              img.id === imageId
                ? { ...img, fileId: result.data.id, uploadComplete: true }
                : img
            )
          );
          return { fileId: result.data.id };
        });

      newImages.push({
        id: imageId,
        previewUrl: URL.createObjectURL(file),
        uploadPromise,
        uploadComplete: false,
      });
    }
    setPendingImages((prev) => [...prev, ...newImages]);
    e.target.value = "";
  };

  const removeImage = (imageId: string) => {
    setPendingImages((prev) => {
      const img = prev.find((p) => p.id === imageId);
      if (img) {
        URL.revokeObjectURL(img.previewUrl);
        // Note: file is already uploaded, but we just won't link it
      }
      return prev.filter((p) => p.id !== imageId);
    });
  };

  const buildMessageBlocks = (
    text: string,
    fileIds: string[]
  ): MessageBlock[] => {
    const blocks: MessageBlock[] = [];
    if (text) {
      blocks.push({ type: "text", content: text });
    }
    for (const fileId of fileIds) {
      blocks.push({ type: "image", fileId });
    }
    return blocks;
  };

  const handleSend = async () => {
    if (!(user && (input.trim() || pendingImages.length > 0))) {
      return;
    }

    const text = input.trim();
    const imagesToSend = [...pendingImages];
    setInput("");
    setPendingImages([]);

    // Check if this is a new session (not yet in database)
    const isNewSession = !selectedSessionId;
    // Use pendingSessionId if we have uploads, otherwise selectedSessionId or new id
    const sessionId = selectedSessionId ?? pendingSessionId ?? id();

    // Clear pending session ID since we're about to create it
    setPendingSessionId(null);
    const messageId = id();
    const assistantMessageId = id();
    const now = new Date();
    const messageOrder = messages.length;

    // Await any remaining uploads (most should already be complete)
    const uploadResults = await Promise.all(
      imagesToSend.map((img) => img.uploadPromise)
    );
    const fileIds = uploadResults.map((r) => r.fileId);

    // Clean up preview URLs
    for (const img of imagesToSend) {
      URL.revokeObjectURL(img.previewUrl);
    }

    const blocks = buildMessageBlocks(text, fileIds);

    // Create session and messages client-side
    const txns: TransactionChunk<AppSchema, "sessions" | "messages">[] = [];

    if (isNewSession) {
      txns.push(
        db._client.tx.sessions[sessionId]!.create({
          provider: selectedProvider,
          model: selectedModel,
          reasoningLevel,
          status: "streaming",
          createdAt: now,
          updatedAt: now,
        }).link({ user: user.id })
      );
      setSelectedSessionId(sessionId);
    } else {
      txns.push(
        db._client.tx.sessions[sessionId]!.update({
          model: selectedModel,
          reasoningLevel,
          status: "streaming",
          updatedAt: now,
        })
      );
    }

    // Create user message with file links
    const userMsgTx = db._client.tx.messages[messageId]!.create({
      role: "user",
      blocks,
      order: messageOrder,
      createdAt: now,
    }).link({ session: sessionId });

    // Link files to message
    if (fileIds.length > 0) {
      txns.push(userMsgTx.link({ files: fileIds }));
    } else {
      txns.push(userMsgTx);
    }

    // Create placeholder assistant message
    txns.push(
      db._client.tx.messages[assistantMessageId]!.create({
        role: "assistant",
        blocks: [{ type: "text", content: "" }],
        order: messageOrder + 1,
        createdAt: now,
      }).link({ session: sessionId })
    );

    await db._client.transact(txns);

    // Trigger the task
    await sendMessage({
      sessionId,
      messageId,
      assistantMessageId,
      userId: user.id,
      isNewSession,
      provider: selectedProvider,
      model: selectedModel,
      reasoningLevel,
    });
  };

  const isDisabled = isPending || selectedSession?.status === "streaming";
  const canSend = !isDisabled && (input.trim() || pendingImages.length > 0);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r">
        <div className="border-b p-3">
          <Button className="w-full" onClick={handleNewSession} size="sm">
            New Session
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.map((session) => (
            <div
              className={`group relative border-b ${
                selectedSessionId === session.id ? "bg-muted" : ""
              }`}
              key={session.id}
            >
              <button
                className="w-full p-3 text-left text-sm hover:bg-muted"
                onClick={() => setSelectedSessionId(session.id)}
                type="button"
              >
                <div className="truncate pr-6 font-medium">
                  {session.messages?.[0]?.blocks?.[0]?.type === "text"
                    ? (
                        session.messages[0].blocks[0] as {
                          type: "text";
                          content: string;
                        }
                      ).content.slice(0, 30)
                    : "New session"}
                </div>
                <div className="text-muted-foreground text-xs">
                  {session.status === "streaming" ? "Streaming..." : "Idle"}
                </div>
              </button>
              <button
                className="absolute top-3 right-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSession(session.id);
                }}
                title="Delete session"
                type="button"
              >
                <Trash2Icon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          {messages.map((msg) => {
            // Check if message has any visible content
            const hasContent = msg.blocks?.some((block) => {
              if (block.type === "text") {
                return Boolean(block.content);
              }
              if (block.type === "image") {
                return true;
              }
              if (block.type === "tool") {
                return true;
              }
              return false;
            });

            // Show streaming indicator for empty assistant messages
            if (msg.role === "assistant" && !hasContent) {
              return (
                <div className="mb-4" key={msg.id}>
                  <div className="inline-block rounded-lg bg-muted p-3">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-current" />
                      Thinking...
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                className={`mb-4 ${msg.role === "user" ? "text-right" : ""}`}
                key={msg.id}
              >
                <div
                  className={`inline-block max-w-[80%] rounded-lg p-3 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.blocks?.map((block, i) => (
                    <div key={`${msg.id}-${i}`}>
                      {block.type === "text" && block.content && (
                        <div className="whitespace-pre-wrap">
                          {block.content}
                        </div>
                      )}
                      {block.type === "image" && (
                        <ImageBlock fileId={block.fileId} files={msg.files} />
                      )}
                      {block.type === "tool" && (
                        <div className="mt-2 rounded border bg-background p-2 text-left text-xs">
                          <div className="font-mono font-semibold">
                            {block.tool.name}
                            <span
                              className={`ml-2 ${getStatusColor(block.tool.status)}`}
                            >
                              ({block.tool.status})
                            </span>
                          </div>
                          {block.tool.input && (
                            <pre className="mt-1 max-h-20 overflow-auto text-muted-foreground">
                              {block.tool.input}
                            </pre>
                          )}
                          {block.tool.output && (
                            <pre className="mt-1 max-h-20 overflow-auto">
                              {block.tool.output}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {isPending && (
            <div className="text-muted-foreground text-sm">Sending...</div>
          )}
        </div>

        {/* Pending images preview */}
        {pendingImages.length > 0 && (
          <div className="flex gap-2 border-t px-4 pt-2">
            {pendingImages.map((img) => (
              <div className="relative" key={img.id}>
                <img
                  alt="pending"
                  className={`h-16 w-16 rounded object-cover ${
                    img.uploadComplete ? "" : "opacity-50"
                  }`}
                  src={img.previewUrl}
                />
                {!img.uploadComplete && (
                  <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                )}
                <button
                  className="-top-1 -right-1 absolute rounded-full bg-destructive p-0.5 text-destructive-foreground"
                  onClick={() => removeImage(img.id)}
                  type="button"
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="border-t p-4">
          <div className="mb-2 flex items-center gap-2">
            <ModelSelector
              disabled={isDisabled}
              lockedProvider={selectedSession ? selectedProvider : undefined}
              onValueChange={handleModelChange}
              value={formatModelValue(selectedProvider, selectedModel)}
            />
            <ReasoningLevelButton
              disabled={isDisabled}
              level={reasoningLevel}
              onCycle={cycleReasoningLevel}
              supportedLevels={supportedLevels}
            />
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <input
              accept="image/*"
              className="hidden"
              multiple
              onChange={handleFileSelect}
              ref={fileInputRef}
              type="file"
            />
            <Button
              disabled={isDisabled}
              onClick={() => fileInputRef.current?.click()}
              size="icon"
              type="button"
              variant="outline"
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
            <Input
              className="flex-1"
              disabled={isDisabled}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              value={input}
            />
            <Button disabled={!canSend} type="submit">
              Send
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ImageBlock({ fileId, files }: { fileId: string; files?: FileData[] }) {
  const file = files?.find((f) => f.id === fileId);
  if (!file?.url) {
    return null;
  }

  return (
    <img alt="attached" className="mt-2 max-h-48 rounded" src={file.url} />
  );
}

export function formatModelValue(provider: Provider, model: string): string {
  return `${provider}:${model}`;
}

/**
 * Signal-strength style reasoning level indicator.
 * Shows 4 dots that fill based on current level.
 * Level 0 shows only the brain icon (collapsed).
 * Levels 1-4 animate in dots + label from behind the brain.
 */
export function ReasoningLevelButton({
  level,
  supportedLevels,
  onCycle,
  disabled,
}: {
  level: ReasoningLevel;
  supportedLevels: readonly ReasoningLevel[];
  onCycle: () => void;
  disabled: boolean;
}) {
  const isExpanded = level > 0;
  const meta = REASONING_LEVEL_META[level];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
            isExpanded && "bg-accent/50"
          )}
          disabled={disabled}
          onClick={onCycle}
          type="button"
        >
          <Brain className="h-4 w-4 shrink-0" />

          {/* Animated dots container */}
          <div
            className={cn(
              "flex items-center gap-1.5 overflow-hidden transition-all duration-200 ease-out",
              isExpanded ? "w-auto opacity-100" : "w-0 opacity-0"
            )}
          >
            {/* Vertical stack of 4 dots */}
            <div className="flex items-end gap-0.5">
              {([1, 2, 3, 4] as const).map((dotLevel) => {
                const isFilled = dotLevel <= level;
                const isAvailable = supportedLevels.includes(dotLevel);
                return (
                  <div
                    className={cn(
                      "w-[3px] rounded-full transition-all duration-150",
                      // Height increases with level for signal-strength look
                      dotLevel === 1 && "h-1.5",
                      dotLevel === 2 && "h-2",
                      dotLevel === 3 && "h-2.5",
                      dotLevel === 4 && "h-3",
                      // Color based on fill state
                      isFilled && "bg-foreground",
                      !isFilled && isAvailable && "bg-muted-foreground/30",
                      !(isFilled || isAvailable) && "bg-muted-foreground/10"
                    )}
                    key={dotLevel}
                  />
                );
              })}
            </div>

            {/* Label slides in */}
            <span className="whitespace-nowrap font-medium text-xs">
              {meta.label}
            </span>
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Adjust thinking level</TooltipContent>
    </Tooltip>
  );
}

export function ModelSelector({
  disabled,
  lockedProvider,
  onValueChange,
  value,
}: {
  disabled: boolean;
  lockedProvider?: Provider;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const showClaude = !lockedProvider || lockedProvider === "claude";
  const showCodex = !lockedProvider || lockedProvider === "codex";

  return (
    <Select disabled={disabled} onValueChange={onValueChange} value={value}>
      <SelectTrigger className="max-h-7 w-auto gap-1 border-0 bg-accent/50 px-2 py-0 text-xs shadow-none hover:bg-accent dark:bg-accent/50 [&>svg]:hidden">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {showClaude && (
          <SelectGroup>
            <SelectLabel>Claude</SelectLabel>
            {CLAUDE_MODELS.map((m) => (
              <SelectItem
                key={formatModelValue("claude", m.value)}
                value={formatModelValue("claude", m.value)}
              >
                {m.displayName}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {showCodex && (
          <SelectGroup>
            <SelectLabel>Codex</SelectLabel>
            {CODEX_MODELS.map((m) => (
              <SelectItem
                key={formatModelValue("codex", m.value)}
                value={formatModelValue("codex", m.value)}
              >
                {m.displayName}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
