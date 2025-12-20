"use client";

import { useTRPCClient } from "@repo/trpc/client";
import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { useCallback, useRef, useState } from "react";

type Message =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string }
  | { id: string; role: "command"; command: string; output: string }
  | { id: string; role: "file"; changes: string };

type CodexEvent = {
  type?: string;
  method?: string;
  threadId?: string;
  params?: {
    delta?: string;
    itemId?: string;
    item?: {
      type: string;
      id: string;
      command?: string;
      changes?: unknown[];
    };
  };
};

function handleCommandStart(e: CodexEvent): Message | null {
  if (e.method !== "item/started") {
    return null;
  }
  if (e.params?.item?.type !== "commandExecution") {
    return null;
  }
  const item = e.params.item;
  return {
    id: item.id,
    role: "command",
    command: item.command ?? "",
    output: "",
  };
}

function handleFileChange(e: CodexEvent): Message | null {
  if (e.method !== "item/started") {
    return null;
  }
  if (e.params?.item?.type !== "fileChange") {
    return null;
  }
  const item = e.params.item;
  return {
    id: item.id,
    role: "file",
    changes: JSON.stringify(item.changes ?? [], null, 2),
  };
}

type EventResult =
  | { action: "setThread"; threadId: string }
  | { action: "appendText"; delta: string }
  | { action: "outputDelta"; itemId: string; delta: string }
  | { action: "addMessage"; message: Message }
  | { action: "none" };

function processEvent(e: CodexEvent): EventResult {
  console.log("[Codex Event]", JSON.stringify(e, null, 2));

  if (e.type === "thread.started" && e.threadId) {
    return { action: "setThread", threadId: e.threadId };
  }
  if (e.method === "item/agentMessage/delta" && e.params?.delta) {
    return { action: "appendText", delta: e.params.delta };
  }
  if (e.method === "item/commandExecution/outputDelta" && e.params?.delta) {
    return {
      action: "outputDelta",
      itemId: e.params.itemId ?? "",
      delta: e.params.delta,
    };
  }
  const cmdMsg = handleCommandStart(e);
  if (cmdMsg) {
    return { action: "addMessage", message: cmdMsg };
  }
  const fileMsg = handleFileChange(e);
  if (fileMsg) {
    return { action: "addMessage", message: fileMsg };
  }
  return { action: "none" };
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
  if (msg.role === "command") {
    return (
      <Card className="border-yellow-300 bg-yellow-50 p-2 font-mono text-sm dark:bg-yellow-950/20">
        <div className="font-semibold text-yellow-700 dark:text-yellow-400">
          $ {msg.command}
        </div>
        {msg.output && (
          <pre className="mt-1 max-h-40 overflow-auto text-muted-foreground text-xs">
            {msg.output}
          </pre>
        )}
      </Card>
    );
  }
  return (
    <Card className="border-blue-300 bg-blue-50 p-2 font-mono text-sm dark:bg-blue-950/20">
      <div className="font-semibold text-blue-700 dark:text-blue-400">
        File changes
      </div>
      <pre className="mt-1 max-h-40 overflow-auto text-muted-foreground text-xs">
        {msg.changes}
      </pre>
    </Card>
  );
}

export default function CodexPage() {
  const client = useTRPCClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const assistantTextRef = useRef("");

  const processStream = useCallback(async (stream: AsyncIterable<unknown>) => {
    assistantTextRef.current = "";

    for await (const event of stream) {
      const result = processEvent(event as CodexEvent);

      switch (result.action) {
        case "setThread":
          setThreadId(result.threadId);
          break;
        case "appendText":
          assistantTextRef.current += result.delta;
          break;
        case "outputDelta":
          setMessages((prev) =>
            prev.map((msg) =>
              msg.role === "command" && msg.id === result.itemId
                ? { ...msg, output: msg.output + result.delta }
                : msg
            )
          );
          break;
        case "addMessage":
          setMessages((prev) => [...prev, result.message]);
          break;
        default:
          break;
      }
    }

    console.log(
      "[Codex] Stream ended, assistantText:",
      assistantTextRef.current
    );
    if (assistantTextRef.current) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: assistantTextRef.current,
        },
      ]);
    }
  }, []);

  const send = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) {
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content },
      ]);
      setInput("");
      setIsStreaming(true);

      try {
        const stream = await client.codex.chat.mutate({
          message: content,
          threadId: threadId ?? undefined,
        });
        await processStream(stream);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Error: ${msg}`,
          },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [client, threadId, isStreaming, processStream]
  );

  return (
    <div className="flex h-full flex-col p-4">
      <h1 className="mb-4 font-bold text-xl">Codex (MorphCloud VM)</h1>

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

      {threadId && (
        <div className="mt-2 text-muted-foreground text-xs">
          Thread: {threadId}
        </div>
      )}
    </div>
  );
}
