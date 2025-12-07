"use client";

import type { InstaQLEntity } from "@instantdb/react";
import { type AppSchema, db, id } from "@repo/db";
import { type AppRouter, useTRPC } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useState } from "react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Instance =
  RouterOutputs["morph"]["instances"]["list"]["instances"][number];
type Snapshot =
  RouterOutputs["morph"]["snapshots"]["list"]["snapshots"][number];
type Machine = InstaQLEntity<AppSchema, "machines">;
type Server = RouterOutputs["hetzner"]["servers"]["list"][number];

export const InstanceStatus = {
  PENDING: "pending",
  READY: "ready",
  PAUSED: "paused",
  SAVING: "saving",
  ERROR: "error",
} as const;
export type InstanceStatus =
  (typeof InstanceStatus)[keyof typeof InstanceStatus];

const shortId = (fullId: string) =>
  `${fullId.slice(0, 4)}...${fullId.slice(-4)}`;

export default function HomePage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: machinesData } = db._client.useQuery({
    machines: {},
  });
  const { data: snapshotsData } = useQuery(
    trpc.morph.snapshots.list.queryOptions()
  );
  const { data: instancesData } = useQuery(
    trpc.morph.instances.list.queryOptions()
  );
  const { data: serversData } = useQuery(
    trpc.hetzner.servers.list.queryOptions()
  );
  const { mutateAsync: createInstance } = useMutation(
    trpc.morph.instances.create.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        }),
    })
  );
  const { mutateAsync: createSnapshot } = useMutation(
    trpc.morph.snapshots.create.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.morph.snapshots.list.queryKey(),
        }),
    })
  );
  const { mutateAsync: stopAllInstances } = useMutation(
    trpc.morph.instances.stopAll.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        }),
    })
  );
  const { mutateAsync: pauseAllInstances } = useMutation(
    trpc.morph.instances.pauseAll.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        }),
    })
  );
  return (
    <div className="flex flex-col items-start gap-4 p-2">
      <h1>Machines</h1>
      <button
        onClick={async () => {
          const newMachineId = id();
          await db._client.transact([
            db._client.tx.machines[newMachineId]!.create({}),
          ]);
          const instance = await createInstance();
          await db._client.transact([
            db._client.tx.machines[newMachineId]!.update({
              morphInstanceId: instance.id,
            }),
          ]);
        }}
        type="button"
      >
        Create Machine
      </button>
      <div className="grid w-full grid-cols-4 gap-2 [&>div]:flex [&>div]:flex-col [&>div]:gap-1 [&_h2]:font-semibold [&_h2]:text-lg">
        <div>
          <div className="flex items-center gap-2">
            <h2>Machines</h2>
          </div>
          {machinesData?.machines.map((machine: Machine) => (
            <MachineRow key={machine.id} machine={machine} />
          ))}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2>Snapshots</h2>
            <button
              className="font-mono text-green-500 text-xs hover:text-green-400"
              onClick={() => createSnapshot()}
              title="Create snapshot"
              type="button"
            >
              ＋
            </button>
          </div>
          {snapshotsData?.snapshots.map((snapshot: Snapshot) => (
            <SnapshotRow key={snapshot.id} snapshot={snapshot} />
          ))}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2>Instances</h2>
            <button
              className="font-mono text-green-500 text-xs hover:text-green-400"
              onClick={() => createInstance()}
              title="Create instance"
              type="button"
            >
              ＋
            </button>
            <button
              className="font-mono text-red-500 text-xs hover:text-red-400"
              onClick={() => stopAllInstances()}
              title="Stop all"
              type="button"
            >
              ■
            </button>
            <button
              className="font-mono text-blue-500 text-xs hover:text-blue-400"
              onClick={() => pauseAllInstances()}
              title="Pause all"
              type="button"
            >
              ⏸
            </button>
          </div>
          {instancesData?.instances.map((instance: Instance) => (
            <InstanceRow instance={instance} key={instance.id} />
          ))}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2>Servers</h2>
          </div>
          {serversData?.map((server: Server) => (
            <ServerRow key={server.id} server={server} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SnapshotRow({ snapshot }: { snapshot: Snapshot }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { mutateAsync: startInstance } = useMutation(
    trpc.morph.instance.start.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        }),
    })
  );
  const { mutateAsync: deleteSnapshot } = useMutation(
    trpc.morph.snapshot.delete.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.morph.snapshots.list.queryKey(),
        }),
    })
  );
  return (
    <div className="flex h-6 items-center justify-between gap-1 rounded border px-1 font-mono text-xs">
      <div className="flex items-center gap-1 truncate">
        <span className="truncate">{snapshot.id}</span>
        <span className="text-gray-500">{snapshot.status}</span>
        <span className="text-gray-500">{snapshot.metadata?.name}</span>
      </div>
      <div className="flex gap-1">
        <button
          className="text-green-500 hover:text-green-400"
          onClick={() => startInstance({ snapshotId: snapshot.id })}
          title="Start instance"
          type="button"
        >
          ▶
        </button>
        <button
          className="text-red-500 hover:text-red-400"
          onClick={() => deleteSnapshot({ snapshotId: snapshot.id })}
          title="Delete"
          type="button"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function MachineRow({ machine }: { machine: Machine }) {
  const trpc = useTRPC();
  const { mutate: reconcileMachine } = useMutation(
    trpc.machines.reconcile.mutationOptions({})
  );

  useEffect(() => {
    if (machine.morphInstanceId) {
      reconcileMachine({
        machineId: machine.id,
        morphInstanceId: machine.morphInstanceId,
      });
    }
  }, [machine.id, machine.morphInstanceId, reconcileMachine]);

  return (
    <div className="flex h-6 items-center justify-between gap-1 rounded border px-1 font-mono text-xs">
      <span className="truncate">{shortId(machine.id)}</span>
      <button
        className="text-red-500 hover:text-red-400"
        onClick={() =>
          db._client.transact([db._client.tx.machines[machine.id]!.delete()])
        }
        type="button"
      >
        ×
      </button>
    </div>
  );
}

function InstanceRow({ instance }: { instance: Instance }) {
  const [branchCount, setBranchCount] = useState(1);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { mutateAsync: pauseInstance } = useMutation(
    trpc.morph.instance.pause.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.snapshots.list.queryKey(),
        });
      },
    })
  );
  const { mutateAsync: resumeInstance } = useMutation(
    trpc.morph.instance.resume.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        }),
    })
  );
  const { mutateAsync: stopInstance } = useMutation(
    trpc.morph.instance.stop.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        }),
    })
  );
  const { mutateAsync: branchInstance } = useMutation(
    trpc.morph.instance.branch.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.snapshots.list.queryKey(),
        });
      },
    })
  );
  return (
    <div className="flex h-6 items-center justify-between gap-1 rounded border px-1 font-mono text-xs">
      <div className="flex items-center gap-1 truncate">
        <span className="truncate">{instance.id}</span>
        <span className="text-gray-500">{instance.status}</span>
        <span className="text-gray-500">{instance.metadata?.name}</span>
      </div>
      <div className="flex gap-1">
        <button
          className="text-red-500 hover:text-red-400"
          onClick={() => stopInstance({ instanceId: instance.id })}
          type="button"
        >
          ■
        </button>
        <button
          className="text-blue-500 hover:text-blue-400 disabled:opacity-30"
          disabled={instance.status !== InstanceStatus.READY}
          onClick={() => pauseInstance({ instanceId: instance.id })}
          type="button"
        >
          ⏸
        </button>
        <button
          className="text-green-500 hover:text-green-400 disabled:opacity-30"
          disabled={instance.status !== InstanceStatus.PAUSED}
          onClick={() => resumeInstance({ instanceId: instance.id })}
          type="button"
        >
          ▶
        </button>
        <input
          className="w-6 appearance-none rounded border bg-transparent px-0.5 text-center text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          min={1}
          onChange={(e) => setBranchCount(Number(e.target.value) || 1)}
          type="number"
          value={branchCount}
        />
        <button
          className="text-purple-500 hover:text-purple-400 disabled:opacity-30"
          disabled={
            instance.status !== InstanceStatus.READY &&
            instance.status !== InstanceStatus.PAUSED
          }
          onClick={() =>
            branchInstance({
              instanceId: instance.id,
              count: branchCount,
              resume: instance.status === InstanceStatus.PAUSED,
            })
          }
          title="Branch"
          type="button"
        >
          ⑂
        </button>
        <a
          className="text-green-500 hover:text-green-400"
          href={`/terminal/${instance.id}?provider=morph`}
          title="Open terminal"
        >
          &gt;_
        </a>
      </div>
    </div>
  );
}

function ServerRow({ server }: { server: Server }) {
  return (
    <div className="flex h-6 items-center justify-between gap-1 rounded border px-1 font-mono text-xs">
      <span className="truncate">{server.name}</span>
      <div className="flex items-center gap-1">
        <span className="text-gray-500">{server.public_net.ipv4.ip}</span>
        <a
          className="text-green-500 hover:text-green-400"
          href={`/terminal/${server.id}`}
          title="Open terminal"
        >
          &gt;_
        </a>
      </div>
    </div>
  );
}
