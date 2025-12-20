/**
 * Typesafe JSON-RPC client for Codex app-server
 *
 * Protocol: JSON-RPC 2.0 over stdio (without "jsonrpc" header)
 * Docs: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
 *
 * Types generated via: codex app-server generate-ts
 */

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export type { RequestId } from "./codex-types/RequestId";
export type { ServerNotification } from "./codex-types/ServerNotification";
export type { ServerRequest } from "./codex-types/ServerRequest";
// Re-export types from generated schema
export type { AskForApproval } from "./codex-types/v2/AskForApproval";
export type { SandboxPolicy } from "./codex-types/v2/SandboxPolicy";
export type { ThreadItem } from "./codex-types/v2/ThreadItem";
export type { ThreadStartParams } from "./codex-types/v2/ThreadStartParams";
export type { ThreadStartResponse } from "./codex-types/v2/ThreadStartResponse";
export type { TurnStartParams } from "./codex-types/v2/TurnStartParams";
export type { TurnStartResponse } from "./codex-types/v2/TurnStartResponse";
export type { UserInput } from "./codex-types/v2/UserInput";

// Internal imports for class implementation
import type { RequestId } from "./codex-types/RequestId";
import type { ServerNotification } from "./codex-types/ServerNotification";
import type { ServerRequest } from "./codex-types/ServerRequest";
import type { ThreadStartParams } from "./codex-types/v2/ThreadStartParams";
import type { ThreadStartResponse } from "./codex-types/v2/ThreadStartResponse";
import type { TurnStartParams } from "./codex-types/v2/TurnStartParams";
import type { TurnStartResponse } from "./codex-types/v2/TurnStartResponse";

// ============================================================================
// JSON-RPC Client
// ============================================================================

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export type ApprovalDecision = { decision: "accept" } | { decision: "decline" };

export interface CodexRpcHandlers {
  onNotification?: (notification: ServerNotification) => void;
  onApprovalRequest?: (request: ServerRequest) => void;
  onClose?: () => void;
}

export class CodexRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private initialized = false;
  private readonly stdin: Writable;
  private readonly stdout: Readable;
  private handlers: CodexRpcHandlers = {};

  constructor(stdin: Writable, stdout: Readable) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.setupReader();
  }

  setHandlers(handlers: CodexRpcHandlers): void {
    this.handlers = handlers;
  }

  private setupReader() {
    const rl = createInterface({ input: this.stdout });

    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch {
        // Ignore malformed lines
      }
    });

    rl.on("close", () => this.handlers.onClose?.());
  }

  private handleMessage(msg: Record<string, unknown>) {
    // Response to a request we sent
    if ("id" in msg && typeof msg.id === "number") {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if ("error" in msg) {
          pending.reject(
            new Error(String((msg.error as { message?: string })?.message))
          );
        } else {
          pending.resolve(msg.result);
        }
        return;
      }

      // Server-initiated request (approval)
      if ("method" in msg) {
        this.handlers.onApprovalRequest?.(msg as ServerRequest);
        return;
      }
    }

    // Notification (no id)
    if ("method" in msg && !("id" in msg)) {
      this.handlers.onNotification?.(msg as ServerNotification);
    }
  }

  private send(method: string, params: unknown, id?: number): void {
    const msg = id !== undefined ? { method, id, params } : { method, params };
    this.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.send(method, params, id);
    });
  }

  respondToRequest(id: RequestId, result: ApprovalDecision): void {
    this.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  // ============================================================================
  // API Methods
  // ============================================================================

  async initialize(clientName = "op-mini", version = "1.0.0"): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.request("initialize", {
      clientInfo: { name: clientName, version },
    });

    this.send("initialized", {});
    this.initialized = true;
  }

  loginApiKey(apiKey: string): Promise<unknown> {
    return this.request("account/login/start", { type: "apiKey", apiKey });
  }

  loginChatGpt(): Promise<{
    type: "chatgpt";
    loginId: string;
    authUrl: string;
  }> {
    return this.request("account/login/start", { type: "chatgpt" });
  }

  threadStart(
    params: Partial<ThreadStartParams> = {}
  ): Promise<ThreadStartResponse> {
    const fullParams: ThreadStartParams = {
      model: params.model ?? null,
      modelProvider: params.modelProvider ?? null,
      cwd: params.cwd ?? null,
      approvalPolicy: params.approvalPolicy ?? null,
      sandbox: params.sandbox ?? null,
      config: params.config ?? null,
      baseInstructions: params.baseInstructions ?? null,
      developerInstructions: params.developerInstructions ?? null,
      experimentalRawEvents: params.experimentalRawEvents ?? false,
    };
    return this.request("thread/start", fullParams);
  }

  threadResume(threadId: string): Promise<ThreadStartResponse> {
    return this.request("thread/resume", { threadId });
  }

  turnStart(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.request("turn/start", params);
  }

  turnInterrupt(threadId: string, turnId: string): Promise<void> {
    return this.request("turn/interrupt", { threadId, turnId });
  }
}
