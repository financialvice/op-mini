import { Buffer } from "node:buffer";
import { type ServerWebSocket, serve } from "bun";
import { MorphCloudClient } from "morphcloud";
import { Client } from "ssh2";

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

type FileToWrite = {
  path: string;
  content: string;
  mode?: string;
};

type TerminalSocketData = {
  provider: "morph" | "hetzner";
  machineId: string;
  env?: Record<string, string>;
  files?: FileToWrite[];
  shell?: ShellStream;
  dispose?: () => void;
};

// Marker that signals setup is complete - frontend will buffer until this is seen
const INIT_COMPLETE_MARKER = "@@INIT_COMPLETE@@";

const port = Number.parseInt(process.env.TERMINAL_BRIDGE_PORT ?? "8787", 10);
const morphApiKey = "morph_k4bK5nJrMbx5oBGWs6cVGe";
const hetznerApiToken = process.env.HETZNER_API_TOKEN;
const hetznerSshKey = process.env.HETZNER_SSH_PRIVATE_KEY;

const morphClient = morphApiKey
  ? new MorphCloudClient({
      apiKey: morphApiKey,
      baseUrl: process.env.MORPH_BASE_URL,
    })
  : null;

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

/**
 * Apply session setup by writing commands directly to the shell.
 * Ends with a marker that the frontend uses to know when setup is complete.
 */
function applySessionSetup(ws: ServerWebSocket<TerminalSocketData>): void {
  const shell = ws.data.shell;
  if (!shell) {
    return;
  }

  const { env, files } = ws.data;

  // Write env vars
  if (env && Object.keys(env).length > 0) {
    for (const [key, value] of Object.entries(env)) {
      const escaped = value.replace(/'/g, "'\\''");
      shell.write(`export ${key}='${escaped}'\n`);
    }
  }

  // Write files
  if (files && files.length > 0) {
    for (const file of files) {
      const path = file.path.replace(/^~/, "$HOME");
      shell.write(`mkdir -p "$(dirname "${path}")"\n`);
      const b64 = Buffer.from(file.content).toString("base64");
      shell.write(`echo '${b64}' | base64 -d > "${path}"\n`);
      if (file.mode) {
        shell.write(`chmod ${file.mode} "${path}"\n`);
      }
    }
  }

  // Send the init complete marker and clear the screen
  shell.write(`echo "${INIT_COMPLETE_MARKER}"; clear\n`);
}

async function fetchHetznerServerIp(serverId: string): Promise<string> {
  if (!hetznerApiToken) {
    throw new Error("HETZNER_API_TOKEN is not configured");
  }
  const res = await fetch(`https://api.hetzner.cloud/v1/servers/${serverId}`, {
    headers: {
      Authorization: `Bearer ${hetznerApiToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error?.message ?? "Failed to fetch server");
  }
  const data = await res.json();
  return data.server.public_net.ipv4.ip;
}

async function openHetznerShell(
  ws: ServerWebSocket<TerminalSocketData>
): Promise<void> {
  const serverId = ws.data.machineId;
  if (!hetznerSshKey) {
    ws.send("Error: HETZNER_SSH_PRIVATE_KEY not configured\r\n");
    ws.close(1011, "missing ssh key");
    return;
  }

  try {
    ws.send(`Fetching server ${serverId} info...\r\n`);
    const ip = await fetchHetznerServerIp(serverId);
    ws.send(`Connecting to ${ip}...\r\n`);

    const ssh = new Client();
    const disposed = { current: false };

    const cleanup = () => {
      if (disposed.current) {
        return;
      }
      disposed.current = true;
      try {
        ssh.end();
      } catch {
        // ignore cleanup errors
      }
    };

    ws.data.dispose = cleanup;

    ssh.on("ready", () => {
      ssh.shell({ term: "xterm-256color" }, (err, stream) => {
        if (err) {
          ws.send(`Error: ${err.message}\r\n`);
          cleanup();
          ws.close(1011, "shell error");
          return;
        }

        ws.data.shell = stream as unknown as ShellStream;

        stream.on("data", (chunk: Buffer) => forwardChunk(ws, chunk));
        stream.stderr?.on("data", (chunk: Buffer) => forwardChunk(ws, chunk));
        stream.on("close", () => {
          ws.send("\r\nSession closed.\r\n");
          cleanup();
          ws.close();
        });

        ws.send("Connected.\r\n");
        applySessionSetup(ws);
      });
    });

    ssh.on("error", (err) => {
      ws.send(`Error: ${err.message}\r\n`);
      cleanup();
      ws.close(1011, "ssh error");
    });

    ssh.connect({
      host: ip,
      port: 22,
      username: "root",
      privateKey: hetznerSshKey,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to open terminal";
    ws.send(`Error: ${message}\r\n`);
    ws.close(1011, "bridge error");
  }
}

async function openMorphShell(
  ws: ServerWebSocket<TerminalSocketData>
): Promise<void> {
  const machineId = ws.data.machineId;
  if (!morphClient) {
    ws.send("Error: MORPH_API_KEY not configured\r\n");
    ws.close(1011, "missing api key");
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

    ws.send("Connected.\r\n");
    applySessionSetup(ws);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to open terminal";
    ws.send(`Error: ${message}\r\n`);
    ws.close(1011, "bridge error");
  }
}

async function openShell(
  ws: ServerWebSocket<TerminalSocketData>
): Promise<void> {
  if (!ws.data.machineId) {
    ws.send("Missing machine identifier.\r\n");
    ws.close(1008, "machine required");
    return;
  }

  if (ws.data.provider === "hetzner") {
    await openHetznerShell(ws);
  } else {
    await openMorphShell(ws);
  }
}

function parseJsonParam<T>(param: string | null): T | undefined {
  if (!param) {
    return;
  }
  try {
    return JSON.parse(decodeURIComponent(param)) as T;
  } catch {
    return;
  }
}

function handleTerminalUpgrade(
  url: URL,
  req: Request,
  serverInstance: {
    upgrade: (req: Request, options?: { data?: TerminalSocketData }) => boolean;
  }
): Response | undefined {
  const machineId = url.searchParams.get("machineId");
  const provider = url.searchParams.get("provider") ?? "morph";

  if (!machineId) {
    return new Response("machineId query param required", { status: 400 });
  }

  if (provider !== "morph" && provider !== "hetzner") {
    return new Response("provider must be 'morph' or 'hetzner'", {
      status: 400,
    });
  }

  const env = parseJsonParam<Record<string, string>>(
    url.searchParams.get("env")
  );
  const files = parseJsonParam<FileToWrite[]>(url.searchParams.get("files"));

  const upgraded = serverInstance.upgrade(req, {
    data: { machineId, provider, env, files },
  });

  if (upgraded) {
    return;
  }

  return new Response("WebSocket upgrade failed", { status: 400 });
}

const bridgeServer = serve<TerminalSocketData, undefined>({
  port,
  fetch(req, serverInstance) {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
      return new Response("ok");
    }

    if (url.pathname === "/terminal") {
      return handleTerminalUpgrade(url, req, serverInstance);
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
