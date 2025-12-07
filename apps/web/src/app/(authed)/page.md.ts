import { adminDb } from "@repo/db/admin";
import { createCaller } from "@repo/trpc";

export async function md() {
  const trpc = await createCaller();
  const { machines } = await adminDb.db.query({
    machines: {},
  });

  const [{ instances }, { snapshots }, servers] = await Promise.all([
    trpc.morph.instances.list(),
    trpc.morph.snapshots.list(),
    trpc.hetzner.servers.list(),
  ]);

  return `# Machines Dashboard

## Machines (${machines.length})
${machines.length > 0 ? machines.map((m) => `- **${m.id}** - ${m.morphInstanceId ?? "No instance"}`).join("\n") : "_No machines_"}

## Instances (${instances.length})
${instances.length > 0 ? instances.map((i) => `- **${i.id}** - ${i.status}`).join("\n") : "_No instances_"}

## Snapshots (${snapshots.length})
${snapshots.length > 0 ? snapshots.map((s) => `- ${s.id}`).join("\n") : "_No snapshots_"}

## Servers (${servers.length})
${servers.length > 0 ? servers.map((s) => `- **${s.name}** (${s.status}) - ${s.public_net.ipv4.ip}`).join("\n") : "_No servers_"}
`;
}
