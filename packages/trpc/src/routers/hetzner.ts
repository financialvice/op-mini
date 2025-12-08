import { Client } from "ssh2";
import z from "zod";
import { t } from "../server";
import { devboxTemplate } from "./machine-templates";

const HETZNER_API = "https://api.hetzner.cloud/v1";
const SSH_KEY_NAME = process.env.HETZNER_SSH_KEY_NAME ?? "platform";

const hetznerFetch = async <T = unknown>(
  endpoint: string,
  options?: RequestInit
): Promise<T> => {
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
  return res.json() as T;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const noop = () => {
  // intentionally empty - used for ignored catch handlers
};

const sshExec = (
  host: string,
  command: string
): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const ssh = new Client();
    let stdout = "";
    let stderr = "";
    ssh.on("ready", () => {
      ssh.exec(command, (err, stream) => {
        if (err) {
          return reject(err);
        }
        stream.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        stream.stderr.on("data", (d: Buffer) => {
          stderr += d.toString();
        });
        stream.on("close", (code: number) => {
          ssh.end();
          resolve({ code, stdout, stderr });
        });
      });
    });
    ssh.on("error", reject);
    ssh.connect({
      host,
      port: 22,
      username: "root",
      privateKey: process.env.HETZNER_SSH_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    });
  });

const waitForSsh = async (ip: string, maxAttempts = 30) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await sshExec(ip, "echo ok");
      return;
    } catch {
      await sleep(2000);
    }
  }
  throw new Error("SSH not ready after timeout");
};

const ServerSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  created: z.string(),
  server_type: z.object({ name: z.string() }),
  public_net: z.object({
    ipv4: z.object({ ip: z.string() }),
    ipv6: z.object({ ip: z.string() }),
  }),
});

const ImageSchema = z
  .object({
    id: z.number(),
    description: z.string().nullable(),
    type: z.string(),
    status: z.string(),
    labels: z.record(z.string(), z.string()),
  })
  .loose();

export const hetznerRouter = t.router({
  sshKeys: {
    ensure: t.procedure.mutation(async () => {
      const { ssh_keys } = await hetznerFetch<{ ssh_keys: { name: string }[] }>(
        "/ssh_keys"
      );
      if (ssh_keys.some((k) => k.name === SSH_KEY_NAME)) {
        return { created: false };
      }
      const publicKey = process.env.HETZNER_SSH_PUBLIC_KEY;
      if (!publicKey) {
        throw new Error("HETZNER_SSH_PUBLIC_KEY not set");
      }
      await hetznerFetch("/ssh_keys", {
        method: "POST",
        body: JSON.stringify({ name: SSH_KEY_NAME, public_key: publicKey }),
      });
      return { created: true };
    }),
  },
  servers: {
    list: t.procedure.output(z.array(ServerSchema)).query(async () => {
      const data = await hetznerFetch<{ servers: unknown[] }>("/servers");
      return data.servers as z.infer<typeof ServerSchema>[];
    }),
    get: t.procedure
      .input(z.object({ id: z.number() }))
      .output(ServerSchema)
      .query(async ({ input }) => {
        const data = await hetznerFetch<{ server: unknown }>(
          `/servers/${input.id}`
        );
        return data.server as z.infer<typeof ServerSchema>;
      }),
    create: t.procedure
      .input(
        z
          .object({ image: z.string().optional(), name: z.string().optional() })
          .optional()
      )
      .output(ServerSchema)
      .mutation(async ({ input }) => {
        const data = await hetznerFetch<{ server: unknown }>("/servers", {
          method: "POST",
          body: JSON.stringify({
            name: input?.name ?? `devbox-${Date.now()}`,
            server_type: "cpx31",
            image: input?.image ?? "ubuntu-24.04",
            location: "hil",
            ssh_keys: [SSH_KEY_NAME],
          }),
        });
        return data.server as z.infer<typeof ServerSchema>;
      }),
    delete: t.procedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await hetznerFetch(`/servers/${input.id}`, { method: "DELETE" });
      }),
  },
  templates: {
    list: t.procedure.output(z.array(ImageSchema)).query(async () => {
      const data = await hetznerFetch<{ images: unknown[] }>(
        "/images?type=snapshot"
      );
      return (data.images as z.infer<typeof ImageSchema>[]).filter(
        (img) => img.labels?.type === "template"
      );
    }),
    delete: t.procedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await hetznerFetch(`/images/${input.id}`, { method: "DELETE" });
      }),
    create: t.procedure
      .input(z.object({ name: z.enum(["devbox"]) }))
      .mutation(async ({ input }) => {
        const template = devboxTemplate;
        const results: {
          command: string;
          code: number;
          stdout: string;
          stderr: string;
        }[] = [];

        // Create build server
        const { server } = await hetznerFetch<{ server: { id: number } }>(
          "/servers",
          {
            method: "POST",
            body: JSON.stringify({
              name: `template-build-${Date.now()}`,
              server_type: "cpx31",
              image: "ubuntu-24.04",
              location: "hil",
              ssh_keys: [SSH_KEY_NAME],
            }),
          }
        );

        try {
          // Wait for server + SSH
          await sleep(10_000);
          const { server: s } = await hetznerFetch<{
            server: z.infer<typeof ServerSchema>;
          }>(`/servers/${server.id}`);
          const ip = s.public_net.ipv4.ip;
          await waitForSsh(ip);

          // Run template commands
          for (const [, command] of template.entries()) {
            const result = await sshExec(ip, command);
            results.push({ command, ...result });
            if (result.code !== 0) {
              await hetznerFetch(`/servers/${server.id}`, { method: "DELETE" });
              throw new Error(
                `Command failed: ${command.slice(0, 50)}... - ${result.stderr || result.stdout}`
              );
            }
          }

          // Create snapshot
          const { image } = await hetznerFetch<{ image: { id: number } }>(
            `/servers/${server.id}/actions/create_image`,
            {
              method: "POST",
              body: JSON.stringify({
                type: "snapshot",
                description: `${input.name}-template`,
                labels: { type: "template", name: input.name },
              }),
            }
          );

          // Poll until snapshot is available
          for (let attempt = 0; attempt < 60; attempt++) {
            const { image: img } = await hetznerFetch<{
              image: { status: string };
            }>(`/images/${image.id}`);
            if (img.status === "available") {
              break;
            }
            await sleep(5000);
          }

          await hetznerFetch(`/servers/${server.id}`, { method: "DELETE" });
          return { success: true, error: null, results, imageId: image.id };
        } catch (error) {
          await hetznerFetch(`/servers/${server.id}`, {
            method: "DELETE",
          }).catch(noop);
          throw error;
        }
      }),
  },
  exec: t.procedure
    .input(z.object({ serverId: z.number(), command: z.string() }))
    .mutation(async ({ input }) => {
      const { server } = await hetznerFetch<{
        server: z.infer<typeof ServerSchema>;
      }>(`/servers/${input.serverId}`);
      return sshExec(server.public_net.ipv4.ip, input.command);
    }),
});
