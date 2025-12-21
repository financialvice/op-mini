import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { type ServerWebSocket, serve } from "bun";
import type { ClientChannel } from "ssh2";
import { Client } from "ssh2";

type FileToWrite = {
  path: string;
  content: string;
  mode?: string;
};

type TerminalSocketData = {
  provider: "morph" | "hetzner" | "fly";
  machineId: string;
  privateIp?: string; // For Fly machines: direct IP when running inside Fly network
  env?: Record<string, string>;
  files?: FileToWrite[];
  cols: number;
  rows: number;
  stream?: ClientChannel;
  dispose?: () => void;
};

type SSHConfig = {
  host: string;
  port: number;
  username: string;
  privateKey: string;
};

const INIT_COMPLETE_MARKER = "@@INIT_COMPLETE@@";
const port = Number.parseInt(process.env.TERMINAL_BRIDGE_PORT ?? "8787", 10);
const morphApiKey = "morph_k4bK5nJrMbx5oBGWs6cVGe";
const hetznerApiToken = process.env.HETZNER_API_TOKEN;
const hetznerSshKey = process.env.HETZNER_SSH_PRIVATE_KEY;
const flySshKey = process.env.FLY_SSH_PRIVATE_KEY;
const flyAppName = "op-mini";

// Temp keypair for Morph (server validates API key in username, not the SSH key)
const { privateKey: morphTempKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

async function getSSHConfig(
  provider: "morph" | "hetzner" | "fly",
  machineId: string,
  privateIp?: string
): Promise<SSHConfig> {
  if (provider === "hetzner") {
    if (!hetznerApiToken) {
      throw new Error("HETZNER_API_TOKEN not configured");
    }
    if (!hetznerSshKey) {
      throw new Error("HETZNER_SSH_PRIVATE_KEY not configured");
    }

    const res = await fetch(
      `https://api.hetzner.cloud/v1/servers/${machineId}`,
      { headers: { Authorization: `Bearer ${hetznerApiToken}` } }
    );
    if (!res.ok) {
      const err = (await res.json()) as { error?: { message?: string } };
      throw new Error(err.error?.message ?? "Failed to fetch server");
    }
    const data = (await res.json()) as {
      server: { public_net: { ipv4: { ip: string } } };
    };

    return {
      host: data.server.public_net.ipv4.ip,
      port: 22,
      username: "root",
      privateKey: hetznerSshKey,
    };
  }

  if (provider === "fly") {
    if (!flySshKey) {
      throw new Error("FLY_SSH_PRIVATE_KEY not configured");
    }

    // If privateIp is provided (when running inside Fly network), connect directly
    if (privateIp) {
      return {
        host: privateIp,
        port: 2222, // Internal SSH port
        username: "root",
        privateKey: flySshKey,
      };
    }

    // Fallback: connect via Fly's proxy (load-balanced across all machines)
    // WARNING: This may connect to a different machine than expected if multiple exist
    console.warn(
      `[fly] No privateIp for ${machineId}, using proxy (may hit wrong machine)`
    );
    return {
      host: `${flyAppName}.fly.dev`,
      port: 22,
      username: "root",
      privateKey: flySshKey,
    };
  }

  return {
    host: "ssh.cloud.morph.so",
    port: 22,
    username: `${machineId}:${morphApiKey}`,
    privateKey: morphTempKey,
  };
}

function applySessionSetup(
  stream: ClientChannel,
  env?: Record<string, string>,
  files?: FileToWrite[]
): void {
  stream.write("export TERM=xterm-256color\n");

  if (env) {
    for (const [key, value] of Object.entries(env)) {
      stream.write(`export ${key}='${value.replace(/'/g, "'\\''")}'\n`);
    }
    if (env.VERCEL_TOKEN) {
      stream.write(`alias vercel='vercel --token "$VERCEL_TOKEN"'\n`);
    }
  }

  if (files) {
    for (const file of files) {
      const path = file.path.replace(/^~/, "$HOME");
      stream.write(`mkdir -p "$(dirname "${path}")"\n`);
      stream.write(
        `echo '${Buffer.from(file.content).toString("base64")}' | base64 -d > "${path}"\n`
      );
      if (file.mode) {
        stream.write(`chmod ${file.mode} "${path}"\n`);
      }
    }
  }

  stream.write(`echo "${INIT_COMPLETE_MARKER}"; clear\n`);
}

/** Safely send data to WebSocket if still open */
function safeSend(ws: ServerWebSocket<TerminalSocketData>, data: string): void {
  try {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  } catch {
    // WebSocket may be closed
  }
}

async function openShell(
  ws: ServerWebSocket<TerminalSocketData>
): Promise<void> {
  const { provider, machineId, privateIp, cols, rows, env, files } = ws.data;

  if (!machineId) {
    safeSend(ws, "Missing machine identifier.\r\n");
    ws.close(1008, "machine required");
    return;
  }

  try {
    safeSend(ws, `Connecting to ${machineId}...\r\n`);
    const config = await getSSHConfig(provider, machineId, privateIp);

    const ssh = new Client();
    let disposed = false;

    const cleanup = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      try {
        ssh.end();
      } catch {
        // ignore
      }
    };

    ws.data.dispose = cleanup;

    ssh.on("ready", () => {
      // Check if connection was disposed during SSH handshake
      if (disposed) {
        return;
      }

      ssh.shell(
        { term: "xterm-256color", cols, rows, modes: { ECHO: 1 } },
        (err, stream) => {
          // Check again after shell is established
          if (disposed) {
            return;
          }

          if (err) {
            safeSend(ws, `Error: ${err.message}\r\n`);
            cleanup();
            ws.close(1011, "shell error");
            return;
          }

          ws.data.stream = stream;

          stream.on("data", (chunk: Buffer) => {
            if (!disposed) {
              safeSend(ws, chunk.toString("utf8"));
            }
          });
          stream.stderr?.on("data", (chunk: Buffer) => {
            if (!disposed) {
              safeSend(ws, chunk.toString("utf8"));
            }
          });
          stream.on("close", () => {
            if (!disposed) {
              safeSend(ws, "\r\nSession closed.\r\n");
            }
            cleanup();
            ws.close();
          });

          safeSend(ws, "Connected.\r\n");
          applySessionSetup(stream, env, files);
        }
      );
    });

    ssh.on("error", (err) => {
      if (!disposed) {
        safeSend(ws, `Error: ${err.message}\r\n`);
        cleanup();
        ws.close(1011, "ssh error");
      }
    });

    ssh.connect(config);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Connection failed";
    safeSend(ws, `Error: ${msg}\r\n`);
    ws.close(1011, "bridge error");
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

const bridgeServer = serve<TerminalSocketData, undefined>({
  port,
  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
      return new Response("ok");
    }

    if (url.pathname === "/terminal") {
      const machineId = url.searchParams.get("machineId");
      const provider = url.searchParams.get("provider") ?? "morph";

      if (!machineId) {
        return new Response("machineId required", { status: 400 });
      }
      if (
        provider !== "morph" &&
        provider !== "hetzner" &&
        provider !== "fly"
      ) {
        return new Response("provider must be 'morph', 'hetzner', or 'fly'", {
          status: 400,
        });
      }

      const upgraded = server.upgrade(req, {
        data: {
          machineId,
          provider,
          privateIp: url.searchParams.get("privateIp") ?? undefined,
          env: parseJsonParam(url.searchParams.get("env")),
          files: parseJsonParam(url.searchParams.get("files")),
          cols: Number.parseInt(url.searchParams.get("cols") ?? "", 10) || 80,
          rows: Number.parseInt(url.searchParams.get("rows") ?? "", 10) || 24,
        },
      });

      return upgraded
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws) {
      openShell(ws);
    },
    message(ws, message) {
      const stream = ws.data.stream;
      if (!stream) {
        return;
      }

      const text =
        typeof message === "string"
          ? message
          : Buffer.from(message).toString("utf8");
      if (!text) {
        return;
      }

      // Handle resize messages
      if (text.startsWith('{"type":"resize"')) {
        try {
          const msg = JSON.parse(text) as {
            type: string;
            cols: number;
            rows: number;
          };
          if (msg.type === "resize") {
            stream.setWindow(msg.rows, msg.cols, 0, 0);
            return;
          }
        } catch {
          // Not JSON, treat as input
        }
      }

      stream.write(text);
    },
    close(ws) {
      ws.data.dispose?.();
      ws.data.stream = undefined;
      ws.data.dispose = undefined;
    },
  },
});

console.log(
  `Terminal bridge listening on ws://${bridgeServer.hostname}:${bridgeServer.port}/terminal`
);
