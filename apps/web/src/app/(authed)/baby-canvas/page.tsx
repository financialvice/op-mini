"use client";

import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_REASONING_LEVEL,
} from "@repo/agents-core";
import { db } from "@repo/db";
import { useTRPC } from "@repo/trpc/client";
import { Button } from "@repo/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@repo/ui/components/input-group";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@repo/ui/components/resizable";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import {
  Background,
  type ProOptions,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import {
  ArrowUpIcon,
  CopyIcon,
  Loader2Icon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type HiddenSessionsStore = {
  hidden: Set<string>;
  hide: (name: string) => void;
  unhide: (name: string) => void;
};

const useHiddenSessions = create<HiddenSessionsStore>()(
  persist(
    (set) => ({
      hidden: new Set<string>(),
      hide: (name) => set((s) => ({ hidden: new Set(s.hidden).add(name) })),
      unhide: (name) =>
        set((s) => {
          const next = new Set(s.hidden);
          next.delete(name);
          return { hidden: next };
        }),
    }),
    {
      name: "baby-canvas-hidden-sessions",
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) {
            return null;
          }
          const parsed = JSON.parse(str);
          return {
            ...parsed,
            state: { ...parsed.state, hidden: new Set(parsed.state.hidden) },
          };
        },
        setItem: (name, value) => {
          const toStore = {
            ...value,
            state: { ...value.state, hidden: [...value.state.hidden] },
          };
          localStorage.setItem(name, JSON.stringify(toStore));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);

const proOptions: ProOptions = {
  hideAttribution: true,
};

const FADE_MAX_X = 24; // 1.5rem in px
const NEW_CHAT_VALUE = "__new__";

type Session = { name: string; path: string };

function ChatSwitcher({
  sessions,
  isNewChat,
  onNewChat,
  onHide,
}: {
  sessions: Session[];
  isNewChat: boolean;
  onNewChat: () => void;
  onHide: (name: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fadeLeft, setFadeLeft] = useState(0);
  const [fadeRight, setFadeRight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const update = () => {
      setFadeLeft(Math.min(el.scrollLeft, FADE_MAX_X));
      const rightScroll = el.scrollWidth - el.clientWidth - el.scrollLeft;
      setFadeRight(Math.min(rightScroll, FADE_MAX_X));
    };
    update();
    el.addEventListener("scroll", update);
    return () => el.removeEventListener("scroll", update);
  }, []);

  // Get display name (remove .jsonl extension)
  const getDisplayName = (name: string) =>
    name.replace(".jsonl", "").slice(0, 8);

  return (
    <div className="flex w-full overflow-hidden p-1">
      <TabsList
        className="fade-mask fade-left-[var(--fade-left)] fade-right-[var(--fade-right)] h-6 min-w-0 flex-1 justify-start gap-px overflow-x-auto rounded-none bg-background p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={ref}
        style={
          {
            "--fade-left": `${fadeLeft}px`,
            "--fade-right": `${fadeRight}px`,
          } as React.CSSProperties
        }
      >
        {isNewChat && (
          <TabsTrigger
            className="h-6 shrink-0 rounded-sm px-1 shadow-none hover:bg-secondary data-[state=active]:bg-secondary data-[state=active]:shadow-none"
            value={NEW_CHAT_VALUE}
          >
            New Chat
          </TabsTrigger>
        )}
        {sessions.map((session) => (
          <div className="group relative" key={session.name}>
            <TabsTrigger
              className="h-6 shrink-0 rounded-sm px-1 shadow-none hover:bg-secondary data-[state=active]:bg-secondary data-[state=active]:shadow-none"
              value={session.name}
            >
              {getDisplayName(session.name)}
            </TabsTrigger>
            <span
              className="-translate-y-1/2 absolute top-1/2 right-0 hidden translate-x-1/2 cursor-pointer rounded-sm bg-secondary p-0.5 hover:bg-muted-foreground/20 group-hover:inline-flex"
              onClick={(e) => {
                e.stopPropagation();
                onHide(session.name);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onHide(session.name);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <XIcon className="h-3 w-3" />
            </span>
          </div>
        ))}
      </TabsList>
      <div className="flex shrink-0 gap-px pl-1">
        <Button
          className="h-6 w-6 rounded-sm"
          onClick={onNewChat}
          size="icon"
          variant="ghost"
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  );
}

function SessionContent({
  content,
  isLoading,
  isEmpty,
}: {
  content?: string;
  isLoading: boolean;
  isEmpty?: boolean;
}) {
  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-muted-foreground text-sm">
        Start a new conversation
      </div>
    );
  }

  // Parse JSONL content - each line is a JSON object
  const lines = content?.split("\n").filter(Boolean) ?? [];

  // Create stable keys using line index (JSONL is append-only so order is stable)
  const lineKeys = lines.map((_, i) => `line-${i}`);

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div className="mb-2 flex justify-end">
        <Button
          className="h-6 gap-1 text-xs"
          onClick={handleCopy}
          size="sm"
          variant="ghost"
        >
          <CopyIcon className="h-3 w-3" />
          Copy
        </Button>
      </div>
      <pre className="whitespace-pre-wrap break-all font-mono text-xs">
        {lines.map((line, i) => {
          const key = lineKeys[i];
          try {
            const parsed = JSON.parse(line);
            return (
              <div className="mb-2 rounded bg-secondary p-2" key={key}>
                {JSON.stringify(parsed, null, 2)}
              </div>
            );
          } catch {
            return (
              <div className="mb-2 rounded bg-secondary p-2" key={key}>
                {line}
              </div>
            );
          }
        })}
      </pre>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  disabled,
  canSend,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  canSend: boolean;
}) {
  return (
    <form
      className="mt-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <InputGroup className="rounded-lg" data-disabled={disabled}>
        <InputGroupTextarea
          className="min-h-16 py-2"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask Operator to make you some apps..."
          value={value}
        />
        <InputGroupAddon align="block-end" className="justify-end p-1.5">
          <InputGroupButton
            aria-label="Send"
            disabled={!canSend}
            size="icon-xs"
            type="submit"
          >
            <ArrowUpIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

function Chat({
  sessions,
  isLoading,
  activeSession,
  isNewChat,
  onSessionChange,
  onNewChat,
  onHide,
  sessionContent,
  sessionContentLoading,
  composerValue,
  onComposerChange,
  onSend,
  sendDisabled,
  canSend,
}: {
  sessions: Session[];
  isLoading: boolean;
  activeSession?: string;
  isNewChat: boolean;
  onSessionChange: (value: string) => void;
  onNewChat: () => void;
  onHide: (name: string) => void;
  sessionContent?: string;
  sessionContentLoading: boolean;
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  sendDisabled: boolean;
  canSend: boolean;
}) {
  const tabValue = isNewChat ? NEW_CHAT_VALUE : (activeSession ?? "");

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show new chat UI if no sessions exist
  if (sessions.length === 0 && !isNewChat) {
    return (
      <div className="flex h-full flex-col p-2">
        <div className="flex flex-1 items-center justify-center p-4 text-center text-muted-foreground text-sm">
          No sessions yet. Start a new conversation!
        </div>
        <Composer
          canSend={canSend}
          disabled={sendDisabled}
          onChange={onComposerChange}
          onSend={onSend}
          value={composerValue}
        />
      </div>
    );
  }

  return (
    <Tabs
      className="flex h-full flex-col p-1"
      onValueChange={onSessionChange}
      value={tabValue}
    >
      <ChatSwitcher
        isNewChat={isNewChat}
        onHide={onHide}
        onNewChat={onNewChat}
        sessions={sessions}
      />
      {isNewChat && (
        <TabsContent
          className="mt-2 flex min-h-0 flex-1 flex-col"
          value={NEW_CHAT_VALUE}
        >
          <SessionContent isEmpty isLoading={false} />
        </TabsContent>
      )}
      {sessions.map((session) => (
        <TabsContent
          className="mt-2 flex min-h-0 flex-1 flex-col"
          key={session.name}
          value={session.name}
        >
          {activeSession === session.name && !isNewChat && (
            <SessionContent
              content={sessionContent}
              isLoading={sessionContentLoading}
            />
          )}
        </TabsContent>
      ))}
      <div className="p-1">
        <Composer
          canSend={canSend}
          disabled={sendDisabled}
          onChange={onComposerChange}
          onSend={onSend}
          value={composerValue}
        />
      </div>
    </Tabs>
  );
}

function Flow() {
  return (
    <ReactFlow className="!bg-secondary rounded-lg" proOptions={proOptions}>
      <Background />
    </ReactFlow>
  );
}

const SESSION_ID_PATTERNS = [
  /"session_id"\s*:\s*"([^"]+)"/,
  /"sessionId"\s*:\s*"([^"]+)"/,
];

function extractSessionId(content?: string): string | undefined {
  if (!content) {
    return;
  }
  for (const pattern of SESSION_ID_PATTERNS) {
    const match = pattern.exec(content);
    if (match?.[1]) {
      return match[1];
    }
  }
}

function extractLastTimestamp(content?: string): number {
  if (!content) {
    return 0;
  }
  const lines = content.split("\n").filter(Boolean);
  // Check last few lines for a timestamp (in case last line is malformed)
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed.timestamp) {
        return new Date(parsed.timestamp).getTime();
      }
    } catch {
      // Skip malformed lines
    }
  }
  return 0;
}

export default function BabyCanvasPage() {
  const trpc = useTRPC();
  const { user } = db._client.useAuth();
  const [message, setMessage] = useState("");
  const [activeSession, setActiveSession] = useState<string | undefined>();
  const [isNewChat, setIsNewChat] = useState(false);
  // Track the agentSessionId we're currently using (for continuing sessions)
  const [currentAgentSessionId, setCurrentAgentSessionId] = useState<
    string | undefined
  >();
  const { hidden, hide } = useHiddenSessions();

  const { mutateAsync: sendMessage, isPending } = useMutation(
    trpc.babyCanvas.sendMessage.mutationOptions()
  );

  // Fetch machines to get the first running one
  const { data: machinesData } = useQuery(
    trpc.fly.machines.list.queryOptions()
  );
  const runningMachine = machinesData?.machines?.find(
    (m) => m.state === "started"
  );

  // Fetch sessions from the running machine
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    ...trpc.babyCanvas.listSessions.queryOptions({
      machineId: runningMachine?.id ?? "",
      project: "-root",
    }),
    enabled: Boolean(runningMachine?.id),
    refetchInterval: 2000,
  });

  // Filter out agent- sessions and hidden sessions
  const filteredSessions = useMemo(
    () =>
      (sessionsData?.sessions ?? []).filter(
        (s) => !(s.name.startsWith("agent-") || hidden.has(s.name))
      ),
    [sessionsData?.sessions, hidden]
  );

  // Fetch all session contents to get timestamps for sorting
  const sessionQueries = useMemo(
    () =>
      filteredSessions.map((session) => ({
        ...trpc.babyCanvas.readSession.queryOptions({
          machineId: runningMachine?.id ?? "",
          path: session.path,
        }),
        enabled: Boolean(runningMachine?.id && session.path),
        refetchInterval: 2000,
        staleTime: 1000,
      })),
    [filteredSessions, runningMachine?.id, trpc.babyCanvas.readSession]
  );
  const sessionContentsQueries = useQueries({ queries: sessionQueries });

  // Build a map of session name -> last timestamp
  const sessionTimestamps = new Map<string, number>();
  for (const [i, query] of sessionContentsQueries.entries()) {
    const session = filteredSessions[i];
    if (session) {
      sessionTimestamps.set(
        session.name,
        extractLastTimestamp(query.data?.content)
      );
    }
  }

  // Sort sessions by most recent message (descending)
  const sessions = [...filteredSessions].sort((a, b) => {
    const tsA = sessionTimestamps.get(a.name) ?? 0;
    const tsB = sessionTimestamps.get(b.name) ?? 0;
    return tsB - tsA; // Most recent first
  });

  // Auto-select first session if none selected and not in new chat mode
  useEffect(() => {
    if (isNewChat) {
      return; // Don't auto-select when in new chat mode
    }
    if (sessions.length === 0) {
      setActiveSession(undefined);
      return;
    }
    if (!(activeSession && sessions.some((s) => s.name === activeSession))) {
      setActiveSession(sessions[0]?.name);
    }
  }, [activeSession, sessions, isNewChat]);

  const selectedSession =
    sessions.find((session) => session.name === activeSession) ?? sessions[0];

  // Fetch selected session content with faster polling for real-time updates
  const { data: sessionData, isLoading: sessionLoading } = useQuery({
    ...trpc.babyCanvas.readSession.queryOptions({
      machineId: runningMachine?.id ?? "",
      path: selectedSession?.path ?? "",
    }),
    enabled: Boolean(runningMachine?.id && selectedSession?.path && !isNewChat),
    refetchInterval: 1000,
  });

  // Extract agentSessionId from selected session content
  const extractedAgentSessionId = extractSessionId(sessionData?.content);

  // Update currentAgentSessionId when session content changes
  useEffect(() => {
    if (extractedAgentSessionId && !isNewChat) {
      setCurrentAgentSessionId(extractedAgentSessionId);
    }
  }, [extractedAgentSessionId, isNewChat]);

  const handleNewChat = useCallback(() => {
    setIsNewChat(true);
    setActiveSession(undefined);
    setCurrentAgentSessionId(undefined);
    setMessage("");
  }, []);

  const handleSessionChange = useCallback(
    (value: string) => {
      if (value === NEW_CHAT_VALUE) {
        handleNewChat();
      } else {
        setIsNewChat(false);
        setActiveSession(value);
        setCurrentAgentSessionId(undefined); // Will be updated when session content loads
      }
    },
    [handleNewChat]
  );

  const handleSend = async () => {
    if (isPending) {
      return;
    }
    const trimmed = message.trim();
    if (!(trimmed && user && runningMachine?.id)) {
      return;
    }
    setMessage("");

    // Determine if this is a new session or continuing
    const agentSessionId = isNewChat ? undefined : currentAgentSessionId;

    await sendMessage({
      machineId: runningMachine.id,
      message: trimmed,
      provider: "claude",
      model: DEFAULT_CLAUDE_MODEL,
      reasoningLevel: DEFAULT_REASONING_LEVEL,
      ...(agentSessionId && { agentSessionId }),
      ...(user?.id && { userId: user.id }),
    });

    // If new chat, exit new chat mode - polling will pick up the new session
    if (isNewChat) {
      setIsNewChat(false);
    }
  };

  const isLoading = !runningMachine || sessionsLoading;
  const sendDisabled = isPending || !runningMachine || !user;
  const canSend = !sendDisabled && Boolean(message.trim());

  return (
    <div className="h-[calc(100vh-1.25rem)] w-full">
      <ReactFlowProvider>
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel className="h-full" defaultSize={30} minSize={20}>
            <Chat
              activeSession={activeSession}
              canSend={canSend}
              composerValue={message}
              isLoading={isLoading}
              isNewChat={isNewChat}
              onComposerChange={setMessage}
              onHide={hide}
              onNewChat={handleNewChat}
              onSend={handleSend}
              onSessionChange={handleSessionChange}
              sendDisabled={sendDisabled}
              sessionContent={sessionData?.content}
              sessionContentLoading={sessionLoading}
              sessions={sessions}
            />
          </ResizablePanel>
          <ResizableHandle className="!bg-transparent" />
          <ResizablePanel className="p-2 pl-0">
            <Flow />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ReactFlowProvider>
    </div>
  );
}
