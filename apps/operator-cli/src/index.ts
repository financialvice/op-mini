import { configure, runs, streams, tasks } from "@trigger.dev/sdk";
import { Command } from "commander";

// Configure Trigger.dev SDK
configure({
  secretKey: process.env.TRIGGER_SECRET_KEY,
});

// Stream event types (must match task-runner)
type ClaudeEvent =
  | { type: "init"; sessionId: string }
  | { type: "text"; content: string }
  | { type: "tool.start"; toolId: string; name: string; input?: string }
  | { type: "tool.done"; toolId: string; output: string }
  | { type: "result"; durationMs?: number; costUsd?: number }
  | { type: "error"; message: string };

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

function handleClaudeEvent(event: ClaudeEvent) {
  switch (event.type) {
    case "init":
      console.log(`Session: ${event.sessionId}`);
      break;
    case "text":
      process.stdout.write(event.content);
      break;
    case "tool.start":
      console.log(`\n[Tool: ${event.name}]`);
      if (event.input) {
        console.log(event.input);
      }
      break;
    case "tool.done": {
      const truncated = event.output.length > 200;
      const output = truncated
        ? `${event.output.slice(0, 200)}...`
        : event.output;
      console.log(`[Output: ${output}]`);
      break;
    }
    case "result": {
      const cost = event.costUsd?.toFixed(4) ?? "N/A";
      console.log(`\n\nCompleted in ${event.durationMs}ms, cost: $${cost}`);
      break;
    }
    case "error":
      console.error(`\nError: ${event.message}`);
      break;
    default:
      // Ignore unknown event types
      break;
  }
}

async function streamAgentEvents(runId: string) {
  // Read stream events - "result" and "error" are terminal events
  const stream = await claudeEventStream.read(runId, {
    timeoutInSeconds: 300,
  });

  for await (const jsonStr of stream) {
    try {
      const event = JSON.parse(jsonStr) as ClaudeEvent;
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
    const morphInstanceId = getMorphInstanceId();

    console.log("Starting Claude agent...");
    if (options.session) {
      console.log(`Resuming session: ${options.session}`);
    }

    const handle = await tasks.trigger("claude-agent", {
      prompt,
      sessionId: options.session,
      morphInstanceId,
    });

    console.log(`Run ID: ${handle.id}`);
    console.log("Streaming events... (Ctrl+C to cancel)\n");

    // Handle Ctrl+C
    let cancelled = false;
    process.on("SIGINT", async () => {
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
    });

    try {
      await streamAgentEvents(handle.id);
      process.exit(0);
    } catch (error) {
      if (!cancelled) {
        console.error(
          "Stream error:",
          error instanceof Error ? error.message : error
        );
        process.exit(1);
      }
    }
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
    const morphInstanceId = getMorphInstanceId();

    console.log(`Resuming session: ${sessionId}`);

    const handle = await tasks.trigger("claude-agent", {
      prompt,
      sessionId,
      morphInstanceId,
    });

    console.log(`Run ID: ${handle.id}`);
    console.log("Streaming events... (Ctrl+C to cancel)\n");

    // Handle Ctrl+C
    let cancelled = false;
    process.on("SIGINT", async () => {
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
    });

    try {
      await streamAgentEvents(handle.id);
      process.exit(0);
    } catch (error) {
      if (!cancelled) {
        console.error(
          "Stream error:",
          error instanceof Error ? error.message : error
        );
        process.exit(1);
      }
    }
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
