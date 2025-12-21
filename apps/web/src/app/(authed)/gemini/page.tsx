"use client";

import type { AppRouter } from "@repo/trpc/client";
import { useTRPC, useTRPCClient } from "@repo/trpc/client";
import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useState } from "react";

type Message =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string };

type RouterOutputs = inferRouterOutputs<AppRouter>;
type GeminiChatOutput = RouterOutputs["gemini"]["chat"];
type GeminiEvent = GeminiChatOutput extends AsyncIterable<infer T> ? T : never;
type GeminiSession = RouterOutputs["gemini"]["getSession"];

function MessageView({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="text-right">
        <span className="inline-block rounded-lg bg-primary px-3 py-2 text-primary-foreground">
          {msg.content}
        </span>
      </div>
    );
  }
  return (
    <div className="text-left">
      <span className="inline-block whitespace-pre-wrap rounded-lg bg-muted px-3 py-2">
        {msg.content}
      </span>
    </div>
  );
}

function createMessage(role: "user" | "assistant", content: string): Message {
  return { id: crypto.randomUUID(), role, content };
}

function processGeminiEvent({
  event,
  currentText,
  setStreamingText,
  setModel,
  setSessionId,
}: {
  event: GeminiEvent;
  currentText: string;
  setStreamingText: (text: string) => void;
  setModel: (model: string) => void;
  setSessionId: (id: string) => void;
}): string {
  if (event.type === "init") {
    setModel(event.model);
    setSessionId(event.session_id);
    return currentText;
  }
  if (event.type === "message" && event.role === "assistant") {
    const newText = event.delta ? currentText + event.content : event.content;
    setStreamingText(newText);
    return newText;
  }
  return currentText;
}

function HealthBadge({
  health,
}: {
  health: { healthy: boolean; version?: string } | undefined;
}) {
  if (!health) {
    return null;
  }
  const className = health.healthy
    ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
    : "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400";
  return (
    <span className={`rounded-full px-2 py-1 text-xs ${className}`}>
      {health.healthy ? (health.version ?? "Online") : "Offline"}
    </span>
  );
}

function StreamingIndicator({ text }: { text: string }) {
  if (text) {
    return (
      <div className="text-left">
        <span className="inline-block whitespace-pre-wrap rounded-lg bg-muted px-3 py-2">
          {text}
          <span className="animate-pulse">▊</span>
        </span>
      </div>
    );
  }
  return <div className="text-muted-foreground">Thinking...</div>;
}

export default function GeminiPage() {
  const client = useTRPCClient();
  const trpc = useTRPC();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const { data: health } = useQuery(trpc.gemini.health.queryOptions());
  const { data: sessions, refetch: refetchSessions } = useQuery(
    trpc.gemini.listSessions.queryOptions()
  );

  const send = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) {
        return;
      }

      setMessages((prev) => [...prev, createMessage("user", content)]);
      setInput("");
      setIsStreaming(true);
      setStreamingText("");
      setEvents([]);

      try {
        const stream = await client.gemini.chat.mutate({
          message: content,
          sessionId: sessionId ?? undefined,
        });

        let currentText = "";
        for await (const event of stream as AsyncIterable<GeminiEvent>) {
          setEvents((prev) => [...prev, JSON.stringify(event)]);
          currentText = processGeminiEvent({
            event,
            currentText,
            setStreamingText,
            setModel,
            setSessionId,
          });
        }

        if (currentText) {
          setMessages((prev) => [
            ...prev,
            createMessage("assistant", currentText),
          ]);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          createMessage("assistant", `Error: ${msg}`),
        ]);
      } finally {
        setIsStreaming(false);
        setStreamingText("");
        await refetchSessions();
      }
    },
    [client, isStreaming, sessionId, refetchSessions]
  );

  const loadSession = useCallback(
    async (selectedId: string) => {
      const session = (await client.gemini.getSession.query({
        sessionId: selectedId,
      })) as GeminiSession;
      setSessionId(session.sessionId);
      setModel(session.model ?? null);
      setMessages(
        session.messages.map((message) => ({
          id: crypto.randomUUID(),
          role: message.role,
          content: message.content,
        }))
      );
      setEvents([]);
      setStreamingText("");
    },
    [client]
  );

  const startNewChat = useCallback(() => {
    setSessionId(null);
    setModel(null);
    setMessages([]);
    setEvents([]);
    setStreamingText("");
  }, []);

  const isServerAvailable = health?.healthy ?? false;

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-bold text-xl">Gemini (Headless CLI)</h1>
        <HealthBadge health={health} />
      </div>

      {(model || sessionId) && (
        <Card className="mb-4 p-2">
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground text-xs">
              {model && <div>Model: {model}</div>}
              {sessionId && <div>Session: {sessionId}</div>}
            </div>
            {sessionId && (
              <Button onClick={startNewChat} size="sm" variant="ghost">
                New Chat
              </Button>
            )}
          </div>
        </Card>
      )}

      {sessions && sessions.length > 0 && (
        <Card className="mb-4 p-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold text-xs">Sessions</div>
            <Button onClick={() => refetchSessions()} size="sm" variant="ghost">
              Refresh
            </Button>
          </div>
          <div className="space-y-2">
            {sessions.map((session) => (
              <button
                className="w-full rounded border px-2 py-1 text-left text-xs hover:bg-muted"
                key={session.sessionId}
                onClick={() => loadSession(session.sessionId)}
                type="button"
              >
                <div className="font-medium">
                  {session.index}. {session.title || "Untitled"}
                </div>
                <div className="text-muted-foreground">
                  {session.relativeTime} · {session.sessionId}
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="flex-1 space-y-3 overflow-auto">
        {messages.map((msg) => (
          <MessageView key={msg.id} msg={msg} />
        ))}
        {isStreaming && <StreamingIndicator text={streamingText} />}
      </div>

      {events.length > 0 && (
        <Card className="mt-4 max-h-64 overflow-auto p-3 text-xs">
          <div className="mb-2 font-semibold">Event stream</div>
          <pre className="whitespace-pre-wrap">
            {events.map((event) => `${event}\n`)}
          </pre>
        </Card>
      )}

      <div className="mt-4 flex gap-2">
        <Input
          className="flex-1"
          disabled={!isServerAvailable}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder={
            isServerAvailable ? "Type a message..." : "Server unavailable"
          }
          value={input}
        />
        <Button
          disabled={isStreaming || !isServerAvailable}
          onClick={() => send(input)}
          type="button"
        >
          Send
        </Button>
      </div>
    </div>
  );
}
