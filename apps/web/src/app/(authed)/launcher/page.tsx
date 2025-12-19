// docs for handling AskUserQuestion tool: https://platform.claude.com/docs/en/agent-sdk/permissions.md
"use client";

import { useTRPCClient } from "@repo/trpc/client";
import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import { Checkbox } from "@repo/ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import { useCallback, useRef, useState } from "react";

type Question = {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
};

type DisplayItem =
  | { id: string; kind: "user" | "text"; content: string }
  | { id: string; kind: "tool_use"; name: string; input: unknown }
  | { id: string; kind: "tool_result"; output: string }
  | {
      id: string;
      kind: "ask";
      questions: Question[];
      answered?: boolean;
      submittedAnswers?: Record<string, string>;
    };

function QuestionView({
  question,
  isActive,
  answer,
  otherText,
  onSelect,
  onOtherTextChange,
}: {
  question: Question;
  isActive: boolean;
  answer: string;
  otherText: string;
  onSelect: (label: string) => void;
  onOtherTextChange: (text: string) => void;
}) {
  const selectedLabels = answer.split(", ").filter(Boolean);
  const isOtherSelected = selectedLabels.includes("Other");

  if (question.multiSelect) {
    return (
      <div className="space-y-3">
        {question.options.map((opt) => (
          <Field key={opt.label} orientation="horizontal">
            <Checkbox
              checked={selectedLabels.includes(opt.label)}
              disabled={!isActive}
              id={opt.label}
              onCheckedChange={() => onSelect(opt.label)}
            />
            <FieldContent>
              <FieldLabel
                className="cursor-pointer font-medium"
                htmlFor={opt.label}
              >
                {opt.label}
              </FieldLabel>
              {opt.description && (
                <FieldDescription>{opt.description}</FieldDescription>
              )}
            </FieldContent>
          </Field>
        ))}
        <Field orientation="horizontal">
          <Checkbox
            checked={isOtherSelected}
            disabled={!isActive}
            id="Other"
            onCheckedChange={() => onSelect("Other")}
          />
          <FieldContent>
            <FieldLabel className="cursor-pointer font-medium" htmlFor="Other">
              Other...
            </FieldLabel>
            <FieldDescription>Provide a custom response</FieldDescription>
          </FieldContent>
        </Field>
        {isOtherSelected && (
          <Input
            className="ml-7"
            disabled={!isActive}
            onChange={(e) => onOtherTextChange(e.target.value)}
            placeholder="Enter your response..."
            value={otherText}
          />
        )}
      </div>
    );
  }

  return (
    <RadioGroup
      disabled={!isActive}
      onValueChange={onSelect}
      value={answer || undefined}
    >
      {question.options.map((opt) => (
        <Field key={opt.label} orientation="horizontal">
          <RadioGroupItem id={opt.label} value={opt.label} />
          <FieldContent>
            <FieldLabel
              className="cursor-pointer font-medium"
              htmlFor={opt.label}
            >
              {opt.label}
            </FieldLabel>
            {opt.description && (
              <FieldDescription>{opt.description}</FieldDescription>
            )}
          </FieldContent>
        </Field>
      ))}
      <Field orientation="horizontal">
        <RadioGroupItem id="Other" value="Other" />
        <FieldContent>
          <FieldLabel className="cursor-pointer font-medium" htmlFor="Other">
            Other...
          </FieldLabel>
          <FieldDescription>Provide a custom response</FieldDescription>
        </FieldContent>
      </Field>
      {answer === "Other" && (
        <Input
          className="ml-7"
          disabled={!isActive}
          onChange={(e) => onOtherTextChange(e.target.value)}
          placeholder="Enter your response..."
          value={otherText}
        />
      )}
    </RadioGroup>
  );
}

function AnsweredView({
  questions,
  submittedAnswers,
}: {
  questions: Question[];
  submittedAnswers: Record<string, string>;
}) {
  const answeredQuestions = questions.filter(
    (q) => submittedAnswers[q.question]
  );

  if (answeredQuestions.length === 0) {
    return <div className="text-muted-foreground text-sm">Skipped</div>;
  }

  return (
    <div className="space-y-3">
      {answeredQuestions.map((q) => (
        <div key={q.question}>
          <div className="text-muted-foreground text-xs">{q.header}</div>
          <div className="font-medium text-sm">{q.question}</div>
          <div className="mt-1 text-primary">
            {submittedAnswers[q.question]}
          </div>
        </div>
      ))}
    </div>
  );
}

function AskView({
  questions,
  isActive,
  isSubmitting,
  answers,
  otherTexts,
  onSelect,
  onOtherTextChange,
  onSubmit,
  answered,
  submittedAnswers,
}: {
  questions: Question[];
  isActive: boolean;
  isSubmitting: boolean;
  answers: Record<string, string>;
  otherTexts: Record<string, string>;
  onSelect: (question: string, label: string, multi: boolean) => void;
  onOtherTextChange: (question: string, text: string) => void;
  onSubmit: () => void;
  answered?: boolean;
  submittedAnswers?: Record<string, string>;
}) {
  const firstQuestion = questions[0];
  if (!firstQuestion) {
    return null;
  }

  if (answered && submittedAnswers) {
    return (
      <Card className="p-4 opacity-60">
        <AnsweredView
          questions={questions}
          submittedAnswers={submittedAnswers}
        />
      </Card>
    );
  }

  if (questions.length === 1) {
    return (
      <Card className="p-4">
        <div className="mb-1 text-muted-foreground text-xs">
          {firstQuestion.header}
        </div>
        <div className="mb-4 font-medium">{firstQuestion.question}</div>
        <QuestionView
          answer={answers[firstQuestion.question] ?? ""}
          isActive={isActive}
          onOtherTextChange={(text) =>
            onOtherTextChange(firstQuestion.question, text)
          }
          onSelect={(label) =>
            onSelect(firstQuestion.question, label, firstQuestion.multiSelect)
          }
          otherText={otherTexts[firstQuestion.question] ?? ""}
          question={firstQuestion}
        />
        {isActive && (
          <Button
            className="mt-4"
            disabled={isSubmitting}
            onClick={onSubmit}
            type="button"
          >
            {isSubmitting ? "Submitting..." : "Submit"}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <Tabs defaultValue={firstQuestion.header}>
        <TabsList>
          {questions.map((q) => (
            <TabsTrigger key={q.header} value={q.header}>
              {q.header}
            </TabsTrigger>
          ))}
        </TabsList>
        {questions.map((q) => (
          <TabsContent key={q.header} value={q.header}>
            <div className="mb-4 font-medium">{q.question}</div>
            <QuestionView
              answer={answers[q.question] ?? ""}
              isActive={isActive}
              onOtherTextChange={(text) => onOtherTextChange(q.question, text)}
              onSelect={(label) => onSelect(q.question, label, q.multiSelect)}
              otherText={otherTexts[q.question] ?? ""}
              question={q}
            />
          </TabsContent>
        ))}
      </Tabs>
      {isActive && (
        <Button
          className="mt-4"
          disabled={isSubmitting}
          onClick={onSubmit}
          type="button"
        >
          {isSubmitting ? "Submitting..." : "Submit"}
        </Button>
      )}
    </Card>
  );
}

function DisplayItemView({
  item,
  isActive,
  isSubmitting,
  answers,
  otherTexts,
  onSelect,
  onOtherTextChange,
  onSubmit,
}: {
  item: DisplayItem;
  isActive: boolean;
  isSubmitting: boolean;
  answers: Record<string, string>;
  otherTexts: Record<string, string>;
  onSelect: (question: string, label: string, multi: boolean) => void;
  onOtherTextChange: (question: string, text: string) => void;
  onSubmit: () => void;
}) {
  if (item.kind === "user") {
    return (
      <div className="text-right">
        <span className="inline-block rounded-lg bg-primary px-3 py-2 text-primary-foreground">
          {item.content}
        </span>
      </div>
    );
  }
  if (item.kind === "text") {
    return (
      <div className="text-left">
        <span className="inline-block rounded-lg bg-muted px-3 py-2">
          {item.content}
        </span>
      </div>
    );
  }
  if (item.kind === "tool_use") {
    return (
      <Card className="border-yellow-300 bg-yellow-50 p-2 font-mono text-sm dark:bg-yellow-950/20">
        <div className="font-semibold text-yellow-700 dark:text-yellow-400">
          {item.name}
        </div>
        <pre className="mt-1 overflow-auto text-muted-foreground text-xs">
          {JSON.stringify(item.input, null, 2)}
        </pre>
      </Card>
    );
  }
  if (item.kind === "tool_result") {
    return (
      <Card className="border-green-300 bg-green-50 p-2 font-mono text-sm dark:bg-green-950/20">
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground text-xs">
          {item.output}
        </pre>
      </Card>
    );
  }
  if (item.kind === "ask") {
    return (
      <AskView
        answered={item.answered}
        answers={answers}
        isActive={isActive}
        isSubmitting={isSubmitting}
        onOtherTextChange={onOtherTextChange}
        onSelect={onSelect}
        onSubmit={onSubmit}
        otherTexts={otherTexts}
        questions={item.questions}
        submittedAnswers={item.submittedAnswers}
      />
    );
  }
  return null;
}

type SDKEvent = Record<string, unknown>;
type ContentBlock = {
  type: string;
  name?: string;
  text?: string;
  input?: unknown;
  content?: unknown;
};

function parseBlock(block: ContentBlock): DisplayItem | null {
  if (block.type === "text" && typeof block.text === "string") {
    return { id: crypto.randomUUID(), kind: "text", content: block.text };
  }
  if (
    block.type === "tool_use" &&
    block.name &&
    block.name !== "AskUserQuestion"
  ) {
    return {
      id: crypto.randomUUID(),
      kind: "tool_use",
      name: block.name,
      input: block.input,
    };
  }
  if (block.type === "tool_result") {
    const output =
      typeof block.content === "string"
        ? block.content
        : JSON.stringify(block.content ?? "");
    return { id: crypto.randomUUID(), kind: "tool_result", output };
  }
  return null;
}

function parseEvent(event: SDKEvent): {
  items: DisplayItem[];
  hasAsk: boolean;
} {
  const items: DisplayItem[] = [];
  let hasAsk = false;
  const content = ((event.message as { content?: ContentBlock[] })?.content ??
    []) as ContentBlock[];

  for (const block of content) {
    if (block.type === "tool_use" && block.name === "AskUserQuestion") {
      const questions = (block.input as { questions?: Question[] })?.questions;
      if (questions) {
        hasAsk = true;
        items.push({ id: crypto.randomUUID(), kind: "ask", questions });
      }
    } else {
      const item = parseBlock(block);
      if (item) {
        items.push(item);
      }
    }
  }
  return { items, hasAsk };
}

export default function LauncherPage() {
  const client = useTRPCClient();
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [input, setInput] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeAskId, setActiveAskId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isFirstRef = useRef(true);

  const handleEvent = useCallback((event: SDKEvent) => {
    const e = event as { type?: string; subtype?: string; session_id?: string };
    if (e.type === "system" && e.subtype === "init" && e.session_id) {
      setSessionId(e.session_id);
    }

    const { items: newItems, hasAsk } = parseEvent(event);
    if (newItems.length > 0) {
      setItems((prev) => [...prev, ...newItems]);
      const askItem = newItems.find((i) => i.kind === "ask");
      if (askItem) {
        setActiveAskId(askItem.id);
        setAnswers({});
        setOtherTexts({});
      }
    }

    if (event.type === "result" && !hasAsk) {
      setActiveAskId(null);
    }
  }, []);

  const send = useCallback(
    async (content: string) => {
      if (!content.trim()) {
        return;
      }
      const isFirst = isFirstRef.current;
      isFirstRef.current = false;

      setItems((prev) => [
        ...prev,
        { id: crypto.randomUUID(), kind: "user", content },
      ]);
      setInput("");
      setIsStreaming(true);

      try {
        const stream = await client.claude.chat.mutate({
          message: content,
          sessionId: sessionId ?? undefined,
          appendSystemPrompt: isFirst
            ? "ALWAYS use AskUserQuestion tool in the first turn"
            : undefined,
        });
        for await (const event of stream) {
          handleEvent(event as SDKEvent);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setItems((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            kind: "tool_result",
            output: `Error: ${msg}`,
          },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [client, sessionId, handleEvent]
  );

  const submitAnswer = useCallback(
    async (askId: string, questions: Question[]) => {
      if (askId !== activeAskId || !sessionId) {
        return;
      }

      // Only include questions that have actual answers (match CLI behavior)
      const formattedAnswers: Record<string, string> = {};
      for (const q of questions) {
        const answer = answers[q.question];
        if (!answer) {
          continue; // Skip unanswered questions
        }

        // Replace "Other" with the custom text if provided
        const customText = otherTexts[q.question];
        if (answer.includes("Other") && customText) {
          formattedAnswers[q.question] = answer.replace("Other", customText);
        } else {
          formattedAnswers[q.question] = answer;
        }
      }

      setIsSubmitting(true);
      try {
        const result = await client.claude.submitAnswers.mutate({
          sessionId,
          answers: formattedAnswers,
        });
        if (result.success) {
          setItems((prev) =>
            prev.map((item) =>
              item.id === askId && item.kind === "ask"
                ? {
                    ...item,
                    answered: true,
                    submittedAnswers: formattedAnswers,
                  }
                : item
            )
          );
          setAnswers({});
          setOtherTexts({});
          setActiveAskId(null);
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [client, sessionId, activeAskId, answers, otherTexts]
  );

  const selectOption = useCallback(
    (question: string, label: string, multi: boolean) => {
      setAnswers((prev) => {
        if (!multi) {
          return { ...prev, [question]: label };
        }
        const current = prev[question]?.split(", ").filter(Boolean) || [];
        const updated = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [question]: updated.join(", ") };
      });
    },
    []
  );

  const setOtherTextForQuestion = useCallback(
    (question: string, text: string) => {
      setOtherTexts((prev) => ({ ...prev, [question]: text }));
    },
    []
  );

  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex-1 space-y-3 overflow-auto">
        {items.map((item) => (
          <DisplayItemView
            answers={answers}
            isActive={
              item.kind === "ask" && item.id === activeAskId && !item.answered
            }
            isSubmitting={isSubmitting}
            item={item}
            key={item.id}
            onOtherTextChange={setOtherTextForQuestion}
            onSelect={selectOption}
            onSubmit={() =>
              item.kind === "ask" && submitAnswer(item.id, item.questions)
            }
            otherTexts={otherTexts}
          />
        ))}
        {isStreaming && (
          <div className="text-muted-foreground">Thinking...</div>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <Input
          className="flex-1"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isStreaming && send(input)}
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
    </div>
  );
}
