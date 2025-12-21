/**
 * Gemini tRPC Router
 *
 * Runs Gemini CLI headless on a remote VM over SSH and streams JSONL events.
 */

import { PassThrough } from "node:stream";
import type { JsonStreamEvent } from "@google/gemini-cli-core";

// Inlined from @google/gemini-cli-core to avoid bundling native deps
export const JsonStreamEventType = {
  INIT: "init",
  MESSAGE: "message",
  TOOL_USE: "tool_use",
  TOOL_RESULT: "tool_result",
  ERROR: "error",
  RESULT: "result",
} as const;

import { Client } from "ssh2";
import { z } from "zod";
import { t } from "../server";

type LocalErrorEvent = {
  type: "error";
  timestamp: string;
  severity: string;
  message: string;
};

type GeminiStreamEvent =
  | JsonStreamEvent
  | { type: "raw"; line: string }
  | LocalErrorEvent;

// MorphCloud SSH configuration
const MORPH_SSH_HOST = "ssh.cloud.morph.so";
const MORPH_SSH_PORT = 22;
const MORPH_API_KEY = process.env.MORPH_API_KEY;
const MORPH_INSTANCE_ID = process.env.MORPH_INSTANCE_ID;
const MORPH_SSH_PRIVATE_KEY = process.env.MORPH_SSH_PRIVATE_KEY;

if (!(MORPH_API_KEY && MORPH_INSTANCE_ID && MORPH_SSH_PRIVATE_KEY)) {
  throw new Error(
    "Missing required environment variables: MORPH_API_KEY, MORPH_INSTANCE_ID, MORPH_SSH_PRIVATE_KEY"
  );
}

function buildGeminiCommand(input: {
  message: string;
  model?: string;
  cwd?: string;
  sessionIndex?: number;
}) {
  const promptArg = JSON.stringify(input.message);
  const modelArg = input.model ? `--model ${input.model}` : "";
  const resumeArg =
    typeof input.sessionIndex === "number"
      ? `--resume ${input.sessionIndex}`
      : "";
  const cwd = JSON.stringify(input.cwd ?? "/home/user");
  const cli =
    `USE_CCPA=true gemini --output-format stream-json --yolo ${modelArg} ${resumeArg} ${promptArg}`.trim();
  return `cd ${cwd} && ${cli}`;
}

function buildCwdCommand(cwd: string | undefined, command: string) {
  const safeCwd = JSON.stringify(cwd ?? "/home/user");
  return `cd ${safeCwd} && ${command}`;
}

async function execRemoteCommand(command: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const sshClient = new Client();
  let stdout = "";
  let stderr = "";

  const resultPromise = new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>((resolve, reject) => {
    sshClient.on("ready", () => {
      sshClient.exec(command, { pty: false }, (err, channel) => {
        if (err) {
          reject(err);
          return;
        }
        channel.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        channel.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        channel.on("close", (code: number | null) => {
          sshClient.end();
          resolve({ stdout, stderr, exitCode: code ?? 0 });
        });
      });
    });
    sshClient.on("error", reject);
  });

  sshClient.connect({
    host: MORPH_SSH_HOST,
    port: MORPH_SSH_PORT,
    username: `${MORPH_INSTANCE_ID}:${MORPH_API_KEY}`,
    privateKey: MORPH_SSH_PRIVATE_KEY,
  });

  return await resultPromise;
}

type GeminiSessionInfo = {
  index: number;
  title: string;
  relativeTime: string;
  sessionId: string;
};

function stripAnsi(input: string) {
  let output = "";
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (char === "\u001b") {
      // Skip ANSI escape sequence
      i += 1;
      if (input[i] === "[") {
        i += 1;
        while (i < input.length && input[i] !== "m") {
          i += 1;
        }
        i += 1;
      }
      continue;
    }
    output += char;
    i += 1;
  }
  return output;
}

function parseSessionLine(line: string): GeminiSessionInfo | null {
  const trimmed = line.trim();
  if (!trimmed.includes("[")) {
    return null;
  }
  const indexEnd = trimmed.indexOf(". ");
  if (indexEnd <= 0) {
    return null;
  }
  const index = Number(trimmed.slice(0, indexEnd));
  if (!Number.isFinite(index)) {
    return null;
  }
  const sessionStart = trimmed.lastIndexOf(" [");
  const sessionEnd = trimmed.lastIndexOf("]");
  if (sessionStart < 0 || sessionEnd < 0 || sessionEnd <= sessionStart) {
    return null;
  }
  const sessionId = trimmed.slice(sessionStart + 2, sessionEnd);
  const beforeSession = trimmed.slice(indexEnd + 2, sessionStart);
  const timeStart = beforeSession.lastIndexOf(" (");
  const timeEnd = beforeSession.lastIndexOf(")");
  if (timeStart < 0 || timeEnd < 0 || timeEnd <= timeStart) {
    return null;
  }
  const title = beforeSession.slice(0, timeStart).trim();
  const relativeTime = beforeSession.slice(timeStart + 2, timeEnd).trim();
  return { index, title, relativeTime, sessionId };
}

async function listSessions(cwd?: string): Promise<GeminiSessionInfo[]> {
  const command = buildCwdCommand(
    cwd,
    "USE_CCPA=true gemini --list-sessions 2>&1"
  );
  const result = await execRemoteCommand(command);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to list sessions");
  }
  const rawOutput = result.stdout || result.stderr;
  const output = stripAnsi(rawOutput).replace(/\r/g, "").trim();
  return output
    .split("\n")
    .map((line) => parseSessionLine(line))
    .filter((session): session is GeminiSessionInfo => session !== null);
}

async function* streamGeminiEvents(
  command: string
): AsyncGenerator<GeminiStreamEvent> {
  const sshClient = new Client();
  const stdoutPassthrough = new PassThrough();
  const stderrPassthrough = new PassThrough();

  const ready = new Promise<void>((resolve, reject) => {
    sshClient.on("ready", () => {
      sshClient.exec(command, { pty: false }, (err, channel) => {
        if (err) {
          reject(err);
          return;
        }
        channel.pipe(stdoutPassthrough);
        channel.stderr.pipe(stderrPassthrough);
        channel.on("close", () => {
          stdoutPassthrough.end();
          stderrPassthrough.end();
          sshClient.end();
        });
        resolve();
      });
    });
    sshClient.on("error", reject);
  });

  sshClient.connect({
    host: MORPH_SSH_HOST,
    port: MORPH_SSH_PORT,
    username: `${MORPH_INSTANCE_ID}:${MORPH_API_KEY}`,
    privateKey: MORPH_SSH_PRIVATE_KEY,
  });

  await ready;

  let buffer = "";
  for await (const chunk of stdoutPassthrough) {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        yield JSON.parse(trimmed) as JsonStreamEvent;
      } catch {
        yield { type: "raw", line: trimmed };
      }
    }
  }

  const stderrText = stderrPassthrough.read()?.toString();
  if (stderrText) {
    yield {
      type: JsonStreamEventType.ERROR,
      timestamp: new Date().toISOString(),
      severity: "error",
      message: stderrText,
    };
  }
}

export const geminiRouter = t.router({
  listSessions: t.procedure
    .input(z.object({ cwd: z.string().optional() }).optional())
    .query(async ({ input }) => listSessions(input?.cwd)),

  getSession: t.procedure
    .input(z.object({ sessionId: z.string(), cwd: z.string().optional() }))
    .query(async ({ input }) => {
      const sessionIdArg = JSON.stringify(input.sessionId);
      const script = `
python3 - <<'PY'
import json, glob, sys
sid = ${sessionIdArg}
for path in glob.glob("/root/.gemini/tmp/*/chats/session-*.json"):
    try:
        with open(path) as f:
            data = json.load(f)
        if data.get("sessionId") == sid:
            print(json.dumps(data))
            sys.exit(0)
    except Exception:
        pass
sys.exit(1)
PY`.trim();
      const command = buildCwdCommand(input.cwd, script);
      const result = await execRemoteCommand(command);
      if (result.exitCode !== 0 || !result.stdout.trim()) {
        throw new Error("Session not found");
      }
      const data = JSON.parse(result.stdout) as {
        sessionId: string;
        startTime?: string;
        lastUpdated?: string;
        messages?: Array<{
          id: string;
          timestamp: string;
          type: "user" | "gemini";
          content: string;
          model?: string;
        }>;
      };
      const messages =
        data.messages?.map((message) => ({
          role:
            message.type === "user"
              ? ("user" as const)
              : ("assistant" as const),
          content: message.content,
        })) ?? [];
      const lastModel =
        data.messages
          ?.slice()
          .reverse()
          .find((message) => message.type === "gemini" && message.model)
          ?.model ?? null;
      return {
        sessionId: data.sessionId,
        startTime: data.startTime,
        lastUpdated: data.lastUpdated,
        model: lastModel,
        messages,
      };
    }),

  /**
   * Main chat endpoint - streams Gemini events
   */
  chat: t.procedure
    .input(
      z.object({
        message: z.string(),
        model: z.string().optional(),
        cwd: z.string().optional(),
        sessionId: z.string().optional(),
      })
    )
    .mutation(async function* ({ input }) {
      let sessionIndex: number | undefined;
      if (input.sessionId) {
        const sessions = await listSessions(input.cwd);
        const match = sessions.find(
          (session) => session.sessionId === input.sessionId
        );
        if (!match) {
          throw new Error("Session not found");
        }
        sessionIndex = match.index;
      }
      const command = buildGeminiCommand({ ...input, sessionIndex });
      for await (const event of streamGeminiEvents(command)) {
        yield event;
      }
    }),

  /**
   * Health check for the Gemini CLI transport
   */
  health: t.procedure.query(() => {
    if (!(MORPH_API_KEY && MORPH_INSTANCE_ID && MORPH_SSH_PRIVATE_KEY)) {
      return {
        healthy: false,
        error: "Missing MorphCloud SSH environment variables",
      };
    }
    return { healthy: true };
  }),
});
