import z from "zod";
import { t } from "../server";

// Fly Machines API: https://machines-api-spec.fly.dev/spec/openapi3.json
const FLY_API = "https://api.machines.dev/v1";
const FLY_APP = "op-mini";

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
  if (res.status === 204) {
    return {} as T;
  }
  return res.json() as T;
};

// SSH public key for machine access (reuse Hetzner key)
const sshPublicKey = process.env.FLY_SSH_PUBLIC_KEY;

// Base machine config for devbox
const getDevboxConfig = () => ({
  image: "registry.fly.io/op-mini:devbox",
  guest: {
    cpu_kind: "shared",
    cpus: 2,
    memory_mb: 4096,
  },
  services: [
    {
      protocol: "tcp",
      internal_port: 2222,
      autostart: true,
      autostop: "off",
      ports: [{ port: 22 }],
    },
    {
      protocol: "tcp",
      internal_port: 42_069,
      autostart: true,
      autostop: "off",
      ports: [{ port: 443, handlers: ["tls", "http"] }],
    },
  ],
  env: {
    SSH_PUBLIC_KEY: sshPublicKey ?? "",
  },
});

const MachineSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.string(),
  region: z.string(),
  created_at: z.string(),
  private_ip: z.string().optional(),
});

type Machine = z.infer<typeof MachineSchema>;

export const flyRouter = t.router({
  machines: {
    list: t.procedure.query(async () => {
      const machines = await flyFetch<Machine[]>(`/apps/${FLY_APP}/machines`);
      return { machines };
    }),
    create: t.procedure
      .input(z.object({ name: z.string().optional() }).optional())
      .mutation(async ({ input }) => {
        const machine = await flyFetch<Machine>(`/apps/${FLY_APP}/machines`, {
          method: "POST",
          body: JSON.stringify({
            name: input?.name ?? `devbox-${Date.now()}`,
            config: getDevboxConfig(),
          }),
        });
        return machine;
      }),
    get: t.procedure
      .input(z.object({ machineId: z.string() }))
      .query(async ({ input }) => {
        const machine = await flyFetch<Machine>(
          `/apps/${FLY_APP}/machines/${input.machineId}`
        );
        return machine;
      }),
    delete: t.procedure
      .input(z.object({ machineId: z.string() }))
      .mutation(async ({ input }) => {
        await flyFetch(`/apps/${FLY_APP}/machines/${input.machineId}`, {
          method: "DELETE",
        });
      }),
    start: t.procedure
      .input(z.object({ machineId: z.string() }))
      .mutation(async ({ input }) => {
        await flyFetch(`/apps/${FLY_APP}/machines/${input.machineId}/start`, {
          method: "POST",
        });
      }),
    stop: t.procedure
      .input(z.object({ machineId: z.string() }))
      .mutation(async ({ input }) => {
        await flyFetch(`/apps/${FLY_APP}/machines/${input.machineId}/stop`, {
          method: "POST",
        });
      }),
    suspend: t.procedure
      .input(z.object({ machineId: z.string() }))
      .mutation(async ({ input }) => {
        await flyFetch(`/apps/${FLY_APP}/machines/${input.machineId}/suspend`, {
          method: "POST",
        });
      }),
  },
});
