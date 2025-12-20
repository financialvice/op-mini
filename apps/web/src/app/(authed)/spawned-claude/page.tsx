"use client";

import { useTRPCClient } from "@repo/trpc/client";
import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { useCallback, useState } from "react";

type Message =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string }
  | { id: string; role: "tool"; name: string; input: unknown }
  | { id: string; role: "tool_result"; output: string };

type SDKEvent = Record<string, unknown>;
type ContentBlock = {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
};

function extractSessionId(event: SDKEvent): string | null {
  const isInit = event.type === "system" && event.subtype === "init";
  return isInit && event.session_id ? (event.session_id as string) : null;
}

function extractContent(event: SDKEvent): { text: string; items: Message[] } {
  const message = event.message as { content?: ContentBlock[] } | undefined;
  const blocks = message?.content ?? [];

  let text = "";
  const items: Message[] = [];

  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      text += block.text;
    }
    if (block.type === "tool_use" && block.name) {
      items.push({
        id: crypto.randomUUID(),
        role: "tool",
        name: block.name,
        input: block.input,
      });
    }
    if (block.type === "tool_result") {
      const output =
        typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content ?? "");
      items.push({
        id: crypto.randomUUID(),
        role: "tool_result",
        output,
      });
    }
  }

  return { text, items };
}

function createUserMessage(content: string): Message {
  return { id: crypto.randomUUID(), role: "user", content };
}

function createAssistantMessage(content: string): Message {
  return { id: crypto.randomUUID(), role: "assistant", content };
}

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
  if (msg.role === "assistant") {
    return (
      <div className="text-left">
        <span className="inline-block whitespace-pre-wrap rounded-lg bg-muted px-3 py-2">
          {msg.content}
        </span>
      </div>
    );
  }
  if (msg.role === "tool") {
    return (
      <Card className="border-yellow-300 bg-yellow-50 p-2 font-mono text-sm dark:bg-yellow-950/20">
        <div className="font-semibold text-yellow-700 dark:text-yellow-400">
          {msg.name}
        </div>
        <pre className="mt-1 max-h-40 overflow-auto text-muted-foreground text-xs">
          {JSON.stringify(msg.input, null, 2)}
        </pre>
      </Card>
    );
  }
  return (
    <Card className="border-green-300 bg-green-50 p-2 font-mono text-sm dark:bg-green-950/20">
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground text-xs">
        {msg.output}
      </pre>
    </Card>
  );
}

export default function SpawnedClaudePage() {
  const client = useTRPCClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const processStream = useCallback(async (stream: AsyncIterable<unknown>) => {
    let assistantText = "";
    for await (const event of stream) {
      const sid = extractSessionId(event as SDKEvent);
      if (sid) {
        setSessionId(sid);
      }

      const { text, items } = extractContent(event as SDKEvent);
      assistantText += text;
      if (items.length > 0) {
        setMessages((prev) => [...prev, ...items]);
      }
    }
    if (assistantText) {
      setMessages((prev) => [...prev, createAssistantMessage(assistantText)]);
    }
  }, []);

  const send = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) {
        return;
      }

      setMessages((prev) => [...prev, createUserMessage(content)]);
      setInput("");
      setIsStreaming(true);

      try {
        const stream = await client.simpClaude.chat.mutate({
          message: content,
          sessionId: sessionId ?? undefined,
        });
        await processStream(stream);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          createAssistantMessage(`Error: ${msg}`),
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [client, sessionId, isStreaming, processStream]
  );

  return (
    <div className="flex h-full flex-col p-4">
      <h1 className="mb-4 font-bold text-xl">Spawned Claude (MorphCloud VM)</h1>

      <div className="flex-1 space-y-3 overflow-auto">
        {messages.map((msg) => (
          <MessageView key={msg.id} msg={msg} />
        ))}
        {isStreaming && (
          <div className="text-muted-foreground">Thinking...</div>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <Input
          className="flex-1"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="Type a message..."
          value={input}
        />
        <Button
          disabled={isStreaming}
          onClick={() => send(input)}
          type="button"
        >
          Send
        </Button>
      </div>

      {sessionId && (
        <div className="mt-2 text-muted-foreground text-xs">
          Session: {sessionId}
        </div>
      )}
    </div>
  );
}
