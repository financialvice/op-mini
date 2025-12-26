import { tasks } from "@trigger.dev/sdk";
import z from "zod";
import { t } from "../server";

const FLY_API = "https://api.machines.dev/v1";
const FLY_APP = "op-mini";

// Fetch wrapper for Fly Machines API
const flyFetch = async <T = unknown>(
  endpoint: string,
  options?: RequestInit
): Promise<T> => {
  const res = await fetch(`${FLY_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.FLY_API_TOKEN}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(
      (error as { error?: { message?: string } }).error?.message ??
        `Fly API error: ${res.status}`
    );
  }
  return res.json() as T;
};

// Fetch wrapper for fs-server on Fly machine (agents-server on port 42070)
const fsFetch = async <T = unknown>(
  machineIp: string,
  endpoint: string
): Promise<T> => {
  const url = `http://[${machineIp}]:42070${endpoint}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`fs-server error: ${res.status}`);
  }
  return res.json() as T;
};

type Machine = {
  id: string;
  name: string;
  state: string;
  region: string;
  private_ip?: string;
};

type Project = { name: string; path: string };
type Session = { name: string; path: string };

export const babyCanvasRouter = t.router({
  // List all Claude projects on a machine
  listProjects: t.procedure
    .input(z.object({ machineId: z.string() }))
    .query(async ({ input }) => {
      const machine = await flyFetch<Machine>(
        `/apps/${FLY_APP}/machines/${input.machineId}`
      );
      if (!machine.private_ip) {
        throw new Error("Machine has no private IP");
      }
      if (machine.state !== "started") {
        throw new Error(`Machine is ${machine.state}, not started`);
      }

      const result = await fsFetch<{ projects: Project[]; error?: string }>(
        machine.private_ip,
        "/fs/claude-projects"
      );
      return result;
    }),

  // List sessions for a specific project
  listSessions: t.procedure
    .input(z.object({ machineId: z.string(), project: z.string() }))
    .query(async ({ input }) => {
      const machine = await flyFetch<Machine>(
        `/apps/${FLY_APP}/machines/${input.machineId}`
      );
      if (!machine.private_ip) {
        throw new Error("Machine has no private IP");
      }
      if (machine.state !== "started") {
        throw new Error(`Machine is ${machine.state}, not started`);
      }

      const result = await fsFetch<{ sessions: Session[]; error?: string }>(
        machine.private_ip,
        `/fs/claude-projects/${encodeURIComponent(input.project)}/sessions`
      );
      return result;
    }),

  // Read a session file
  readSession: t.procedure
    .input(z.object({ machineId: z.string(), path: z.string() }))
    .query(async ({ input }) => {
      const machine = await flyFetch<Machine>(
        `/apps/${FLY_APP}/machines/${input.machineId}`
      );
      if (!machine.private_ip) {
        throw new Error("Machine has no private IP");
      }
      if (machine.state !== "started") {
        throw new Error(`Machine is ${machine.state}, not started`);
      }

      const result = await fsFetch<{ content: string; size: number }>(
        machine.private_ip,
        `/fs/read?path=${encodeURIComponent(input.path)}`
      );
      return result;
    }),

  sendMessage: t.procedure
    .input(
      z.object({
        machineId: z.string(),
        message: z.string().min(1),
        agentSessionId: z.string().optional(),
        provider: z.enum(["claude", "codex"]),
        model: z.string(),
        reasoningLevel: z.number().int().min(0).max(4),
        oauthToken: z.string().optional(),
        userId: z.string().optional(), // Fetch OAuth tokens for this user
      })
    )
    .mutation(async ({ input }) => {
      const machine = await flyFetch<Machine>(
        `/apps/${FLY_APP}/machines/${input.machineId}`
      );
      if (!machine.private_ip) {
        throw new Error("Machine has no private IP");
      }
      if (machine.state !== "started") {
        throw new Error(`Machine is ${machine.state}, not started`);
      }

      const handle = await tasks.trigger("baby-canvas-send", {
        machineIp: machine.private_ip,
        message: input.message,
        agentSessionId: input.agentSessionId,
        provider: input.provider,
        model: input.model,
        reasoningLevel: input.reasoningLevel,
        oauthToken: input.oauthToken,
        userId: input.userId,
      });

      // Return run ID - client polls session files to see new sessions
      return { runId: handle.id };
    }),
});
