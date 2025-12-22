#!/usr/bin/env bun
/**
 * End-to-end tests for operator CLI agent commands.
 *
 * Tests:
 * 1. Resume - Start session, resume with follow-up, verify context preserved
 * 2. Stop - Start long-running task, stop mid-execution, verify partial completion
 *
 * Requirements:
 * - TRIGGER_SECRET_KEY
 * - MORPH_INSTANCE_ID
 * - MORPH_API_KEY (for verification commands)
 *
 * Run: bun run test:e2e
 */

import { spawn, spawnSync } from "node:child_process";

const TRIGGER_SECRET_KEY = process.env.TRIGGER_SECRET_KEY;
const MORPH_INSTANCE_ID = process.env.MORPH_INSTANCE_ID;
const MORPH_API_KEY = process.env.MORPH_API_KEY;

if (!(TRIGGER_SECRET_KEY && MORPH_INSTANCE_ID && MORPH_API_KEY)) {
  console.error(
    "Missing required env vars: TRIGGER_SECRET_KEY, MORPH_INSTANCE_ID, MORPH_API_KEY"
  );
  process.exit(1);
}

const CLI_PATH = new URL("../dist/index.js", import.meta.url).pathname;

// Helper to run CLI commands
function runCli(
  args: string[],
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn("node", [CLI_PATH, ...args], {
      env: {
        ...process.env,
        TRIGGER_SECRET_KEY,
        MORPH_INSTANCE_ID,
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeout = options?.timeout ?? 120_000;
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

// Helper to run morphcloud commands
function morphExec(command: string): string {
  const result = spawnSync(
    "morphcloud",
    ["instance", "exec", MORPH_INSTANCE_ID!, "--", command],
    {
      env: { ...process.env, MORPH_API_KEY },
      encoding: "utf-8",
      timeout: 30_000,
    }
  );
  return result.stdout || result.stderr || "";
}

// Poll until condition is met or timeout
async function pollUntil(
  fn: () => boolean,
  { timeout = 30_000, interval = 1000 } = {}
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

// Extract session ID from CLI output
function extractSessionId(output: string): string | null {
  const match = output.match(/Session:\s*([a-f0-9-]+)/);
  return match ? match[1] : null;
}

// Extract run ID from CLI output
function extractRunId(output: string): string | null {
  const match = output.match(/Run ID:\s*(run_[a-z0-9]+)/);
  return match ? match[1] : null;
}

// Test results
const results: { name: string; passed: boolean; error?: string }[] = [];

function test(name: string, passed: boolean, error?: string) {
  results.push({ name, passed, error });
  const status = passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${status} ${name}`);
  if (error) {
    console.log(`    Error: ${error}`);
  }
}

// ============================================================================
// Test: Resume
// ============================================================================
async function testResume() {
  console.log("\n\x1b[1mTest: Resume Session\x1b[0m");

  // Step 1: Start agent with name
  console.log("  Starting first session...");
  const start = await runCli(
    ["agents", "start", "My name is TestUser123. Remember this name."],
    { timeout: 60_000 }
  );

  const sessionId = extractSessionId(start.stdout);
  if (!sessionId) {
    test("Extract session ID", false, "No session ID in output");
    return;
  }
  test("Extract session ID", true);

  // Verify first response acknowledges the name
  const mentionsName =
    start.stdout.toLowerCase().includes("testuser123") ||
    start.stdout.toLowerCase().includes("remember");
  test("First response acknowledges name", mentionsName);

  // Step 2: Resume with follow-up question
  console.log("  Resuming session...");
  const resume = await runCli(
    ["agents", "resume", sessionId, "What is my name?"],
    { timeout: 60_000 }
  );

  // Verify response contains the name
  const remembersName = resume.stdout.toLowerCase().includes("testuser123");
  test(
    "Resume preserves context (remembers name)",
    remembersName,
    remembersName ? undefined : `Output: ${resume.stdout.slice(0, 200)}`
  );

  // Verify same session ID
  const resumeSessionId = extractSessionId(resume.stdout);
  test("Same session ID used", sessionId === resumeSessionId);
}

// ============================================================================
// Test: Stop
// ============================================================================
async function testStop() {
  console.log("\n\x1b[1mTest: Stop Running Agent\x1b[0m");

  const testFile1 = "/tmp/e2e_test_file_1.txt";
  const testFile2 = "/tmp/e2e_test_file_2.txt";

  // Clean up test files
  morphExec(`rm -f ${testFile1} ${testFile2}`);

  // Step 1: Start agent with multi-step task (shorter sleep for faster test)
  console.log("  Starting agent with long-running task...");
  const startPromise = runCli(
    [
      "agents",
      "start",
      `Do these 3 steps in exact order: 1) Write 'first' to ${testFile1} 2) Run bash command: sleep 15 3) Write 'second' to ${testFile2}`,
    ],
    { timeout: 30_000 }
  );

  // Wait for first file to appear (poll every 500ms, max 20s)
  let runId: string | null = null;
  let firstFileExists = false;

  // Give it a moment to start
  await new Promise((r) => setTimeout(r, 3000));

  // Poll for first file
  const fileAppeared = await pollUntil(
    () => {
      const result = morphExec(
        `cat ${testFile1} 2>/dev/null || echo "NOT_FOUND"`
      );
      firstFileExists = result.includes("first");
      return firstFileExists;
    },
    { timeout: 20_000, interval: 500 }
  );

  test("First file written", fileAppeared);

  if (!fileAppeared) {
    // Can't continue test
    await startPromise;
    return;
  }

  // Run in background, capture run ID early
  let capturedOutput = "";

  const bgProc = spawn(
    "node",
    [
      CLI_PATH,
      "agents",
      "start",
      `Do these 3 steps in exact order: 1) Write 'step1' to ${testFile1} 2) Run bash command: sleep 15 3) Write 'step2' to ${testFile2}`,
    ],
    {
      env: { ...process.env, TRIGGER_SECRET_KEY, MORPH_INSTANCE_ID },
    }
  );

  bgProc.stdout.on("data", (data) => {
    capturedOutput += data.toString();
  });

  // Clean first - files might exist from failed parse of startPromise
  morphExec(`rm -f ${testFile1} ${testFile2}`);

  // Wait for run ID and first file
  await pollUntil(
    () => {
      runId = extractRunId(capturedOutput);
      return runId !== null;
    },
    { timeout: 10_000, interval: 300 }
  );

  test("Captured run ID", runId !== null);

  if (!runId) {
    bgProc.kill();
    return;
  }

  // Wait for first file
  await pollUntil(
    () => {
      const result = morphExec(
        `cat ${testFile1} 2>/dev/null || echo "NOT_FOUND"`
      );
      return result.includes("step1");
    },
    { timeout: 20_000, interval: 500 }
  );

  // Stop the agent
  const stopResult = await runCli(["agents", "stop", runId], {
    timeout: 10_000,
  });
  test("Stop command succeeded", stopResult.stdout.includes("stopped"));

  // Kill background process
  bgProc.kill();

  // Verify second file doesn't exist immediately
  const immediateCheck = morphExec(
    `cat ${testFile2} 2>/dev/null || echo "NOT_FOUND"`
  );
  test(
    "Second file not written (immediate)",
    immediateCheck.includes("NOT_FOUND")
  );

  // Wait for what would have been the sleep duration + buffer
  console.log("  Waiting to verify second file never appears...");
  await new Promise((r) => setTimeout(r, 18_000)); // 15s sleep + 3s buffer

  const finalCheck = morphExec(
    `cat ${testFile2} 2>/dev/null || echo "NOT_FOUND"`
  );
  test(
    "Second file never written (after wait)",
    finalCheck.includes("NOT_FOUND"),
    finalCheck.includes("NOT_FOUND") ? undefined : `File content: ${finalCheck}`
  );

  // Cleanup
  morphExec(`rm -f ${testFile1} ${testFile2}`);
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log("\x1b[1m\x1b[34m");
  console.log("╔════════════════════════════════════════╗");
  console.log("║   Operator CLI End-to-End Tests        ║");
  console.log("╚════════════════════════════════════════╝");
  console.log("\x1b[0m");

  await testResume();
  await testStop();

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log("\n\x1b[1mSummary\x1b[0m");
  console.log(`  Passed: \x1b[32m${passed}\x1b[0m`);
  console.log(`  Failed: \x1b[31m${failed}\x1b[0m`);

  if (failed > 0) {
    console.log("\n\x1b[31mFailed tests:\x1b[0m");
    const failedTests = results.filter((result) => !result.passed);
    for (const r of failedTests) {
      console.log(`  - ${r.name}${r.error ? `: ${r.error}` : ""}`);
    }
    process.exit(1);
  }

  console.log("\n\x1b[32mAll tests passed!\x1b[0m");
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
