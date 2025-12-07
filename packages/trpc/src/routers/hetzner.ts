import z from "zod";
import { t } from "../server";

const HETZNER_API = "https://api.hetzner.cloud/v1";

const hetznerFetch = async (endpoint: string, options?: RequestInit) => {
  const res = await fetch(`${HETZNER_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.HETZNER_API_TOKEN}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error?.message ?? "Hetzner API error");
  }
  return res.json();
};

// Simple output schemas
const ServerSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  public_net: z.object({
    ipv4: z.object({ ip: z.string() }),
    ipv6: z.object({ ip: z.string() }),
  }),
});

const SSHKeySchema = z.object({
  id: z.number(),
  name: z.string(),
  fingerprint: z.string(),
});

export const hetznerRouter = t.router({
  servers: {
    list: t.procedure.output(z.array(ServerSchema)).query(async () => {
      const data = await hetznerFetch("/servers");
      return data.servers;
    }),
    get: t.procedure
      .input(z.object({ id: z.number() }))
      .output(ServerSchema)
      .query(async ({ input }) => {
        const data = await hetznerFetch(`/servers/${input.id}`);
        return data.server;
      }),
    create: t.procedure.output(ServerSchema).mutation(async () => {
      const data = await hetznerFetch("/servers", {
        method: "POST",
        body: JSON.stringify({
          name: `devbox-${Date.now()}`,
          server_type: "cpx31",
          image: "ubuntu-24.04",
          location: "hil",
          ssh_keys: ["cam-mbp"],
        }),
      });
      return data.server;
    }),
    delete: t.procedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await hetznerFetch(`/servers/${input.id}`, { method: "DELETE" });
      }),
  },
  sshKeys: {
    list: t.procedure.output(z.array(SSHKeySchema)).query(async () => {
      const data = await hetznerFetch("/ssh_keys");
      return data.ssh_keys;
    }),
  },
});
