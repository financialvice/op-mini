import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { i, id, init } from "@instantdb/admin";
import { configure, runs, streams, tasks } from "@trigger.dev/sdk";
import { Command } from "commander";
import { MorphCloudClient } from "morphcloud";
import { version } from "../package.json";

// Minimal schema for canvas commands
const canvasSchema = i.schema({
  entities: {
    canvasCommands: i.entity({
      expression: i.string(),
      status: i.string<"pending" | "completed" | "error">().indexed(),
      result: i.json<unknown>().optional(),
      error: i.string().optional(),
      createdAt: i.date().indexed(),
    }),
  },
});

// Initialize InstantDB admin client
const canvasDb = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema: canvasSchema,
});

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

async function runAgent(
  prompt: string,
  options: { sessionId?: string; userId?: string } = {}
): Promise<number> {
  const morphInstanceId = getMorphInstanceId();

  // Use provided userId or fall back to SWITCHBOARD_USER_ID env var
  const userId = options.userId ?? process.env.SWITCHBOARD_USER_ID;

  const handle = await tasks.trigger("claude-agent", {
    prompt,
    sessionId: options.sessionId,
    morphInstanceId,
    userId,
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
  .version(version);

// agents commands
const agents = program.command("agents").description("Manage agents");

agents
  .command("start")
  .description("Start a new Claude agent")
  .argument("<prompt>", "The prompt for the agent")
  .option("--session <id>", "Resume an existing session")
  .option("--user <id>", "User ID to fetch OAuth tokens for")
  .action(
    async (prompt: string, options: { session?: string; user?: string }) => {
      console.log("Starting Claude agent...");
      if (options.session) {
        console.log(`Resuming session: ${options.session}`);
      }
      if (options.user) {
        console.log(`Using credentials for user: ${options.user}`);
      }
      const exitCode = await runAgent(prompt, {
        sessionId: options.session,
        userId: options.user,
      });
      process.exit(exitCode);
    }
  );

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
  .option("--user <id>", "User ID to fetch OAuth tokens for")
  .action(
    async (sessionId: string, prompt: string, options: { user?: string }) => {
      console.log(`Resuming session: ${sessionId}`);
      if (options.user) {
        console.log(`Using credentials for user: ${options.user}`);
      }
      const exitCode = await runAgent(prompt, {
        sessionId,
        userId: options.user,
      });
      process.exit(exitCode);
    }
  );

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

// canvas commands
const canvas = program.command("canvas").description("Control the canvas");

canvas
  .command("eval")
  .description("Evaluate an expression on the canvas")
  .argument(
    "<expression>",
    "The JavaScript expression to evaluate (uses $ API)"
  )
  .option("--timeout <ms>", "Timeout in milliseconds", "10000")
  .action(async (expression: string, options: { timeout: string }) => {
    const timeout = Number.parseInt(options.timeout, 10);
    const commandId = id();

    // Write command to InstantDB
    await canvasDb.transact(
      canvasDb.tx.canvasCommands[commandId]!.update({
        expression,
        status: "pending",
        createdAt: new Date(),
      })
    );

    console.log(`Command sent: ${commandId}`);
    console.log("Waiting for result...");

    // Poll for result
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const result = await canvasDb.query({
        canvasCommands: {
          $: { where: { id: commandId } },
        },
      });

      const cmd = result.canvasCommands?.[0];
      if (!cmd) {
        console.error("Command not found");
        process.exit(1);
      }

      if (cmd.status === "completed") {
        console.log("\nResult:");
        console.log(JSON.stringify(cmd.result, null, 2));
        process.exit(0);
      }

      if (cmd.status === "error") {
        console.error("\nError:", cmd.error);
        process.exit(1);
      }

      // Wait 100ms before polling again
      await new Promise((r) => setTimeout(r, 100));
    }

    console.error("\nTimeout waiting for result");
    process.exit(1);
  });

canvas
  .command("help")
  .description("Show canvas API reference")
  .action(() => {
    console.log(`
Canvas API Reference
====================

The canvas is controlled via JavaScript expressions using the $ object.

DISCOVERY
---------
$.types()                      - List available node types with examples
$.help()                       - Get API reference (in canvas)
$.summary()                    - Get canvas overview (nodes, edges, types)

QUERIES
-------
$.all()                        - Get all nodes
$.find('type')                 - Find nodes by type
$.find(n => n.data.x > 10)     - Find nodes by predicate
$.get('node-id')               - Get a specific node

NODE TYPES
----------
note     - Colored sticky note
           data: { label?, text?, color?: 'yellow'|'blue'|'green'|'pink'|'purple' }

preview  - Iframe embed for websites
           data: { label?, url, width?, height? }

NODE OPERATIONS
---------------
$.create(type, options)        - Create a node
  options: { id?, pos?: [x,y], size?: [w,h], data?: {} }

$.get('id').move(x, y)         - Move a node
$.get('id').resize(w, h)       - Resize a node
$.get('id').set({ key: val })  - Update node data
$.get('id').delete()           - Delete a node

CONNECTIONS
-----------
$.connect('from', 'to')        - Connect two nodes

CANVAS
------
$.clear()                      - Clear all nodes and edges

VIEWPORT (all support optional duration in ms for animation)
--------
$.viewport.get()                       - Get current viewport
$.viewport.set(x, y, zoom, duration?)  - Set viewport position
$.viewport.fitAll(duration?)           - Fit all nodes in view
$.viewport.center('id', {zoom?, duration?}) - Center on a node

EXAMPLES
--------
# Create a yellow sticky note
operator canvas eval "$.create('note', { pos: [100, 100], data: { label: 'Hello', text: 'World', color: 'yellow' } })"

# Create a website preview
operator canvas eval "$.create('preview', { pos: [500, 100], data: { url: 'https://example.com', label: 'Example' } })"

# Resize a node
operator canvas eval "$.get('abc123').resize(400, 300)"

# Animate viewport to center on a node
operator canvas eval "$.viewport.center('abc123', { zoom: 1.5, duration: 800 })"

# Get available node types
operator canvas eval "$.types()"
`);
  });

// ============================================================================
// Templates
// ============================================================================

/**
 * Devbox Template - Standard development environment
 *
 * Installs: Node.js LTS, Bun, GitHub CLI, Vercel CLI, Claude Code, Codex CLI,
 * tmux, pm2, uv, morphcloud CLI, agents-server
 */
const DEVBOX_TEMPLATE: string[] = [
  // Set hostname for consistent prompt across providers
  "hostnamectl set-hostname operator",

  // Update apt and install base dependencies
  "apt-get update",
  "apt-get install -y ca-certificates gnupg tmux unzip",

  // Install GitHub CLI (gh)
  "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg",
  "chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg",
  'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list',

  // Install Node.js LTS (v20.x) via NodeSource
  "mkdir -p /etc/apt/keyrings",
  "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg",
  'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list',
  "apt-get update",
  "apt-get install -y nodejs gh",

  // Install Bun and configure PATH for all shell types
  "curl -fsSL https://bun.sh/install | bash",
  `cat >> ~/.profile << 'EOF'
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
EOF`,
  `cat >> ~/.bashrc << 'EOF'
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
EOF`,

  // Install pm2 globally via bun
  "$HOME/.bun/bin/bun install -g pm2",

  // Install AI coding assistants and deployment tools globally via bun
  "$HOME/.bun/bin/bun install -g @anthropic-ai/claude-code @openai/codex vercel",

  // Configure npm for private packages (token injected at runtime)
  'echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > ~/.npmrc',

  // Install agents-server for unified agent management
  "$HOME/.bun/bin/bun install -g @camglynn/agents-server",

  // Install uv (fast Python package installer) and morphcloud CLI
  "curl -LsSf https://astral.sh/uv/install.sh | sh",
  `cat >> ~/.profile << 'EOF'
export PATH="$HOME/.local/bin:$PATH"
EOF`,
  `cat >> ~/.bashrc << 'EOF'
export PATH="$HOME/.local/bin:$PATH"
EOF`,
  "$HOME/.local/bin/uv tool install morphcloud",

  // Start wake service on port 42069 for HTTP health checks (with CORS headers)
  `$HOME/.bun/bin/pm2 start --name wake "node -e \\"require('http').createServer((req,res)=>{res.writeHead(200,{'Access-Control-Allow-Origin':'*'});res.end('ok')}).listen(42069)\\""`,

  // Start agents-server on port 42070 (provides HTTP API for agent sessions)
  `$HOME/.bun/bin/pm2 start --name agents-server "PORT=42070 DEFAULT_WORKING_DIR=/root agents-server"`,
  "$HOME/.bun/bin/pm2 save",

  // Clean up apt cache to save disk space
  "apt-get clean",
  "rm -rf /var/lib/apt/lists/*",
];

// Initialize MorphCloud client
function getMorphClient(): MorphCloudClient {
  const apiKey = process.env.MORPH_API_KEY;
  if (!apiKey) {
    console.error("Missing required environment variable: MORPH_API_KEY");
    process.exit(1);
  }
  return new MorphCloudClient({ apiKey });
}

type TemplateCreateOptions =
  | {
      type: "append";
      name?: string;
      description?: string;
      commands: string[]; // Additional commands to run on top of devbox
    }
  | {
      type: "custom";
      name?: string;
      description?: string;
      commands: string[]; // Additional commands after devbox base setup
    };

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CLI logic requires branching
async function createTemplate(options: TemplateCreateOptions): Promise<string> {
  const morph = getMorphClient();
  const { type, name, description, commands } = options;

  // Store user commands separately (before we prepend devbox for custom)
  const userCommands = [...commands];

  console.log(`Creating ${type} template${name ? ` "${name}"` : ""}...`);
  console.log(`Commands to execute: ${commands.length}`);

  // Determine base snapshot
  let baseSnapshot: Awaited<ReturnType<typeof morph.snapshots.list>>[number];

  if (type === "append") {
    // Find existing devbox template
    const templates = await morph.snapshots.list({
      metadata: { type: "template", name: "devbox" },
    });

    const template = templates[0];
    if (!template) {
      console.error(
        "No devbox template found. Run with --type custom first, or create devbox template via tRPC."
      );
      process.exit(1);
    }

    baseSnapshot = template;
    console.log(`Starting from devbox template: ${baseSnapshot.id}`);
  } else {
    // Start fresh from morphvm-minimal
    console.log("Creating base snapshot from morphvm-minimal...");

    // Check if morphvm-minimal base already exists
    const baseSnapshots = await morph.snapshots.list({
      digest: "morphvm-minimal",
    });

    const existingBase = baseSnapshots[0];
    if (existingBase) {
      baseSnapshot = existingBase;
      console.log(`Using existing base snapshot: ${baseSnapshot.id}`);
    } else {
      baseSnapshot = await morph.snapshots.create({
        imageId: "morphvm-minimal",
        vcpus: 1,
        memory: 4096,
        diskSize: 16_384,
        metadata: { type: "template-base" },
        digest: "morphvm-minimal",
      });
      console.log(`Created new base snapshot: ${baseSnapshot.id}`);
    }

    // For custom type, prepend the devbox template commands
    commands.unshift(...DEVBOX_TEMPLATE);
    console.log(`Total commands (including devbox base): ${commands.length}`);
  }

  // Execute commands, chaining snapshots
  let currentSnapshot = baseSnapshot;
  const totalSteps = commands.length;

  for (let idx = 0; idx < commands.length; idx++) {
    const command = commands[idx];
    if (!command) {
      continue;
    }

    const stepNum = idx + 1;
    const isLastStep = stepNum === totalSteps;

    console.log(
      `\n[${stepNum}/${totalSteps}] ${command.slice(0, 80)}${command.length > 80 ? "..." : ""}`
    );

    try {
      // setup() returns a NEW snapshot with the command applied
      currentSnapshot = await currentSnapshot.setup(command);

      // Add metadata to make intermediate snapshots clear
      const templateName =
        name || (type === "custom" ? "custom" : "devbox-extended");
      await currentSnapshot.setMetadata({
        type: isLastStep ? "template" : "template-step",
        name: templateName,
        step: `${stepNum}/${totalSteps}`,
        command: command.slice(0, 200),
        completed: String(stepNum),
        ...(isLastStep
          ? {
              // Final template gets full metadata
              ...(description ? { description } : {}),
              commands: JSON.stringify(userCommands),
              base: type === "append" ? "devbox" : "morphvm-minimal",
            }
          : { progress: `${Math.round((stepNum / totalSteps) * 100)}%` }),
      });

      console.log(`  ✓ Snapshot: ${currentSnapshot.id}`);
    } catch (error) {
      console.error(`\n✗ Command failed at step ${stepNum}/${totalSteps}`);
      console.error(`  Command: ${command}`);
      console.error(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      );
      console.error(
        "\nTo debug, start an instance from the last successful snapshot and inspect:"
      );
      console.error(`  morphcloud instance start ${currentSnapshot.id}`);
      process.exit(1);
    }
  }

  console.log("\n✓ Template created successfully!");
  console.log(`  Snapshot ID: ${currentSnapshot.id}`);
  console.log(
    `  Name: ${name || (type === "custom" ? "custom" : "devbox-extended")}`
  );

  return currentSnapshot.id;
}

// Helper: Read commands from stdin
async function readCommandsFromStdin(): Promise<string[]> {
  const chunks: Buffer[] = [];
  process.stdin.setEncoding("utf8");

  if (process.stdin.isTTY) {
    return [];
  }

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  const input = Buffer.concat(chunks).toString("utf8").trim();
  if (!input) {
    return [];
  }

  // Try parsing as JSON array first
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall back to newline-separated commands
  }

  return input.split("\n").filter((c) => c.trim());
}

// Helper: Display a template snapshot
type MorphSnapshot = Awaited<
  ReturnType<ReturnType<typeof getMorphClient>["snapshots"]["list"]>
>[number];

function displayTemplateSnapshot(snapshot: MorphSnapshot): void {
  console.log(`  ${snapshot.id}`);
  console.log(`    Name: ${snapshot.metadata?.name || "(unnamed)"}`);
  if (snapshot.metadata?.description) {
    console.log(`    Description: ${snapshot.metadata.description}`);
  }
  console.log(`    Status: ${snapshot.status}`);
  if (snapshot.metadata?.base) {
    console.log(`    Base: ${snapshot.metadata.base}`);
  }
  if (snapshot.digest) {
    console.log(`    Digest: ${snapshot.digest.slice(0, 16)}...`);
  }
  if (snapshot.metadata?.step) {
    console.log(`    Steps: ${snapshot.metadata.step}`);
  }
  displayTemplateCommands(snapshot.metadata?.commands);
  console.log();
}

// Helper: Display template commands
function displayTemplateCommands(commandsJson: string | undefined): void {
  if (!commandsJson) {
    return;
  }
  try {
    const cmds = JSON.parse(commandsJson) as string[];
    console.log(`    Commands (${cmds.length}):`);
    for (const cmd of cmds.slice(0, 5)) {
      console.log(`      - ${cmd.slice(0, 60)}${cmd.length > 60 ? "..." : ""}`);
    }
    if (cmds.length > 5) {
      console.log(`      ... and ${cmds.length - 5} more`);
    }
  } catch {
    // Ignore parse errors
  }
}

// templates commands
const templates = program
  .command("templates")
  .description("Manage VM templates");

templates
  .command("create")
  .description("Create a new template from setup commands")
  .option(
    "-t, --type <type>",
    'Template type: "append" (extend devbox) or "custom" (from scratch)',
    "append"
  )
  .option("-n, --name <name>", "Template name (recommended)")
  .option("-d, --description <desc>", "Template description")
  .argument("[commands...]", "Setup commands to execute")
  .action(
    async (
      commandArgs: string[],
      options: { type: string; name?: string; description?: string }
    ) => {
      // Validate type
      if (options.type !== "append" && options.type !== "custom") {
        console.error('Invalid type. Must be "append" or "custom".');
        process.exit(1);
      }

      // Get commands from args or stdin
      const commands =
        commandArgs.length > 0 ? commandArgs : await readCommandsFromStdin();

      if (commands.length === 0) {
        console.error(
          "No commands provided. Pass commands as arguments or pipe JSON array to stdin."
        );
        console.error("\nUsage:");
        console.error(
          '  operator templates create "apt install -y vim" "npm install -g typescript"'
        );
        console.error(
          "  echo '[\"apt install -y vim\"]' | operator templates create"
        );
        process.exit(1);
      }

      const snapshotId = await createTemplate({
        type: options.type as "append" | "custom",
        name: options.name,
        description: options.description,
        commands,
      });

      // Output just the snapshot ID for easy scripting
      console.log(`\nSnapshot ID: ${snapshotId}`);
    }
  );

templates
  .command("list")
  .description("List available templates")
  .action(async () => {
    const morph = getMorphClient();
    const snapshots = await morph.snapshots.list({});

    const templateSnapshots = snapshots.filter(
      (s) => s.metadata?.type === "template"
    );

    if (templateSnapshots.length === 0) {
      console.log("No templates found.");
      return;
    }

    console.log("Available templates:\n");
    for (const snapshot of templateSnapshots) {
      displayTemplateSnapshot(snapshot);
    }
  });

program.parse();
