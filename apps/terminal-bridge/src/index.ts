import { Buffer } from "node:buffer";
import { type ServerWebSocket, serve } from "bun";
import { MorphCloudClient } from "morphcloud";

type ShellStream = {
  write: (input: string) => boolean;
  close: () => void;
  on: (
    event: "data" | "close" | "exit" | "error",
    listener: (...args: unknown[]) => void
  ) => ShellStream;
  stderr?: {
    on: (event: "data", listener: (chunk: Buffer | string) => void) => void;
  };
};

type TerminalSocketData = {
  machineId: string;
  shell?: ShellStream;
  dispose?: () => void;
};

const port = Number.parseInt(process.env.TERMINAL_BRIDGE_PORT ?? "8787", 10);
const apiKey = process.env.MORPH_API_KEY;

if (!apiKey) {
  throw new Error("MORPH_API_KEY is required to start the terminal bridge");
}

const morphClient = new MorphCloudClient({
  apiKey,
  baseUrl: process.env.MORPH_BASE_URL,
});

function toText(payload: string | ArrayBuffer | Uint8Array): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (payload instanceof ArrayBuffer) {
    return Buffer.from(payload).toString("utf8");
  }

  return Buffer.from(payload).toString("utf8");
}

function forwardChunk(
  ws: ServerWebSocket<TerminalSocketData>,
  chunk: string | Buffer
): void {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  if (text.length === 0) {
    return;
  }
  ws.send(text);
}

async function openShell(
  ws: ServerWebSocket<TerminalSocketData>
): Promise<void> {
  const machineId = ws.data.machineId;
  if (!machineId) {
    ws.send("Missing machine identifier.\r\n");
    ws.close(1008, "machine required");
    return;
  }

  try {
    ws.send(`Connecting to ${machineId}...\r\n`);
    const instance = await morphClient.instances.get({ instanceId: machineId });
    const ssh = await instance.ssh();
    const shell = await ssh.requestShell({ term: "xterm-256color" });

    const disposed = { current: false };
    const cleanup = () => {
      if (disposed.current) {
        return;
      }
      disposed.current = true;
      try {
        shell.close();
      } catch {
        // ignore cleanup errors
      }
      Promise.resolve(ssh.dispose?.()).catch(() => {
        // best effort cleanup
      });
    };

    ws.data.shell = shell;
    ws.data.dispose = cleanup;

    shell.on("data", (chunk: Buffer | string) =>
      forwardChunk(ws, chunk as Buffer | string)
    );
    shell.stderr?.on("data", (chunk: Buffer | string) =>
      forwardChunk(ws, chunk as Buffer | string)
    );
    shell.on("close", () => {
      ws.send("\r\nSession closed.\r\n");
      cleanup();
      ws.close();
    });
    shell.on("exit", (code: number | undefined) => {
      if (typeof code === "number") {
        ws.send(`\r\nProcess exited with code ${code}.\r\n`);
      }
      cleanup();
      ws.close();
    });
    shell.on("error", (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Shell error occurred";
      ws.send(`\r\nError: ${message}\r\n`);
      cleanup();
      ws.close(1011, "shell error");
    });

    ws.send("Connected. Press Ctrl+C twice to terminate.\r\n");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to open terminal";
    ws.send(`Error: ${message}\r\n`);
    ws.close(1011, "bridge error");
  }
}

const bridgeServer = serve<TerminalSocketData, undefined>({
  port,
  fetch(req, serverInstance) {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
      return new Response("ok");
    }

    if (url.pathname === "/terminal") {
      const machineId = url.searchParams.get("machineId");
      if (!machineId) {
        return new Response("machineId query param required", { status: 400 });
      }

      const upgraded = serverInstance.upgrade(req, {
        data: { machineId },
      });

      if (upgraded) {
        return;
      }

      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    async open(ws: ServerWebSocket<TerminalSocketData>) {
      await openShell(ws);
    },
    message(ws: ServerWebSocket<TerminalSocketData>, message) {
      if (!ws.data.shell) {
        return;
      }
      const text = toText(message);
      if (text.length === 0) {
        return;
      }
      ws.data.shell.write(text);
    },
    close(ws: ServerWebSocket<TerminalSocketData>) {
      ws.data.dispose?.();
      ws.data.shell = undefined;
      ws.data.dispose = undefined;
    },
  },
});

console.log(
  `Terminal bridge listening on ws://${bridgeServer.hostname}:${bridgeServer.port}/terminal`
);
