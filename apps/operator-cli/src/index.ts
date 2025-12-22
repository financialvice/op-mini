import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { configure, runs, streams, tasks } from "@trigger.dev/sdk";
import { Command } from "commander";

// Configure Trigger.dev SDK
configure({
  secretKey: process.env.TRIGGER_SECRET_KEY,
});

type StreamError = { type: "error"; message: string };
type ClaudeStreamEvent = SDKMessage | StreamError;

// Define the stream (JSON strings, must match task-runner)
const claudeEventStream = streams.define<string>({
  id: "claude-events",
});

// ============================================================================
// Helper Functions
// ============================================================================

function getMorphInstanceId(): string {
  const morphInstanceId = process.env.MORPH_INSTANCE_ID;
  if (!morphInstanceId) {
    console.error("Missing required environment variable: MORPH_INSTANCE_ID");
    process.exit(1);
  }
  return morphInstanceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatOutput(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content) ?? "";
}

function handleSystemEvent(event: SDKMessage): boolean {
  if (event.type !== "system" || event.subtype !== "init") {
    return false;
  }
  console.log(`Session: ${event.session_id}`);
  return true;
}

function handleAssistantEvent(event: SDKMessage): boolean {
  if (event.type !== "assistant") {
    return false;
  }

  const content = Array.isArray(event.message?.content)
    ? event.message.content
    : [];

  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      process.stdout.write(block.text);
      continue;
    }

    if (
      block.type === "tool_use" &&
      typeof block.name === "string" &&
      typeof block.id === "string"
    ) {
      console.log(`\n[Tool: ${block.name}]`);
      if (block.input !== undefined) {
        console.log(JSON.stringify(block.input, null, 2));
      }
    }
  }
  return true;
}

function handleUserEvent(event: SDKMessage): boolean {
  if (event.type !== "user") {
    return false;
  }

  const content = Array.isArray(event.message?.content)
    ? event.message.content
    : [];

  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_result") {
      continue;
    }

    const output = formatOutput(block.content);
    const truncated = output.length > 200;
    const display = truncated ? `${output.slice(0, 200)}...` : output;
    console.log(`[Output: ${display}]`);
  }
  return true;
}

function handleResultEvent(event: SDKMessage): boolean {
  if (event.type !== "result") {
    return false;
  }

  const duration = event.duration_ms ?? "N/A";
  const cost =
    typeof event.total_cost_usd === "number"
      ? event.total_cost_usd.toFixed(4)
      : "N/A";
  console.log(`\n\nCompleted in ${duration}ms, cost: $${cost}`);
  return true;
}

function handleClaudeEvent(event: ClaudeStreamEvent) {
  if (event.type === "error") {
    console.error(`\nError: ${event.message}`);
    return;
  }

  if (handleSystemEvent(event)) {
    return;
  }
  if (handleAssistantEvent(event)) {
    return;
  }
  if (handleUserEvent(event)) {
    return;
  }
  handleResultEvent(event);
}

async function streamAgentEvents(runId: string) {
  // Read stream events - "result" and "error" are terminal events
  const stream = await claudeEventStream.read(runId, {
    timeoutInSeconds: 300,
  });

  for await (const jsonStr of stream) {
    try {
      const event = JSON.parse(jsonStr) as ClaudeStreamEvent;
      handleClaudeEvent(event);

      // "result" and "error" are terminal events - exit after receiving them
      if (event.type === "result" || event.type === "error") {
        break;
      }
    } catch {
      console.error("Failed to parse event:", jsonStr);
    }
  }

  console.log("\nAgent finished.");
}

async function runAgent(prompt: string, sessionId?: string): Promise<number> {
  const morphInstanceId = getMorphInstanceId();

  const handle = await tasks.trigger("claude-agent", {
    prompt,
    sessionId,
    morphInstanceId,
  });

  console.log(`Run ID: ${handle.id}`);
  console.log("Streaming events... (Ctrl+C to cancel)\n");

  let cancelled = false;
  const onSigint = async () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    console.log("\n\nCancelling agent...");
    try {
      await runs.cancel(handle.id);
      console.log("Agent cancelled.");
    } catch {
      console.error("Failed to cancel agent");
    }
    process.exit(0);
  };

  process.on("SIGINT", onSigint);

  try {
    await streamAgentEvents(handle.id);
    return 0;
  } catch (error) {
    if (!cancelled) {
      console.error(
        "Stream error:",
        error instanceof Error ? error.message : error
      );
      return 1;
    }
    return 0;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

// ============================================================================
// CLI
// ============================================================================

const program = new Command();

program
  .name("operator")
  .description("Operator CLI for managing agents")
  .version("0.0.1");

// agents commands
const agents = program.command("agents").description("Manage agents");

agents
  .command("start")
  .description("Start a new Claude agent")
  .argument("<prompt>", "The prompt for the agent")
  .option("--session <id>", "Resume an existing session")
  .action(async (prompt: string, options: { session?: string }) => {
    console.log("Starting Claude agent...");
    if (options.session) {
      console.log(`Resuming session: ${options.session}`);
    }
    const exitCode = await runAgent(prompt, options.session);
    process.exit(exitCode);
  });

agents
  .command("stop")
  .description("Stop a running agent")
  .argument("<runId>", "The run ID to stop")
  .action(async (runId: string) => {
    console.log(`Stopping agent ${runId}...`);
    try {
      await runs.cancel(runId);
      console.log("Agent stopped.");
    } catch (error) {
      console.error(
        "Failed to stop agent:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

agents
  .command("status")
  .description("Get status of a running agent")
  .argument("<runId>", "The run ID to check")
  .action(async (runId: string) => {
    try {
      const run = await runs.retrieve(runId);
      console.log(`Run ID: ${run.id}`);
      console.log(`Status: ${run.status}`);
      console.log(`Task: ${run.taskIdentifier}`);
      if (run.createdAt) {
        console.log(`Created: ${new Date(run.createdAt).toISOString()}`);
      }
    } catch (error) {
      console.error(
        "Failed to get status:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

agents
  .command("resume")
  .description("Resume an existing agent session")
  .argument("<sessionId>", "The session ID to resume")
  .argument("<prompt>", "The prompt for the agent")
  .action(async (sessionId: string, prompt: string) => {
    console.log(`Resuming session: ${sessionId}`);
    const exitCode = await runAgent(prompt, sessionId);
    process.exit(exitCode);
  });

// dbs commands
const dbs = program.command("dbs").description("Manage databases");

dbs
  .command("create")
  .description("Create a new database")
  .action(() => {
    console.log("Creating database...");
  });

dbs
  .command("delete")
  .description("Delete a database")
  .action(() => {
    console.log("Deleting database...");
  });

// env commands
const envCmd = program
  .command("env")
  .description("Manage environment variables");

envCmd
  .command("add")
  .description("Add an environment variable")
  .action(() => {
    console.log("Adding environment variable...");
  });

envCmd
  .command("list")
  .description("List environment variables")
  .action(() => {
    console.log("Listing environment variables...");
  });

envCmd
  .command("pull")
  .description("Pull environment variables")
  .action(() => {
    console.log("Pulling environment variables...");
  });

envCmd
  .command("remove")
  .description("Remove an environment variable")
  .action(() => {
    console.log("Removing environment variable...");
  });

program.parse();
