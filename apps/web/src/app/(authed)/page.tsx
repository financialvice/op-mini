"use client";

import type { InstaQLEntity } from "@instantdb/react";
import { type AppSchema, db, id } from "@repo/db";
import { type AppRouter, useTRPC } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Instance =
  RouterOutputs["morph"]["instances"]["list"]["instances"][number];
type Snapshot =
  RouterOutputs["morph"]["snapshots"]["list"]["snapshots"][number];
type Machine = InstaQLEntity<AppSchema, "machines">;
type Server = RouterOutputs["hetzner"]["servers"]["list"][number];
type HetznerTemplate = RouterOutputs["hetzner"]["templates"]["list"][number];

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
  const { data: instancesData } = useQuery({
    ...trpc.morph.instances.list.queryOptions(),
    refetchInterval: 5000, // Poll every 5 seconds to track status changes
  });
  const { data: serversData } = useQuery(
    trpc.hetzner.servers.list.queryOptions()
  );
  const { data: hetznerTemplates } = useQuery(
    trpc.hetzner.templates.list.queryOptions()
  );
  const { data: statsData } = useQuery({
    ...trpc.morph.stats.queryOptions(),
    refetchInterval: 5000, // Poll every 5 seconds
  });
  const { mutateAsync: createInstance } = useMutation(
    trpc.morph.instances.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.stats.queryKey(),
        });
      },
    })
  );
  const { mutateAsync: createSnapshot } = useMutation(
    trpc.morph.snapshots.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.morph.snapshots.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.stats.queryKey(),
        });
      },
    })
  );
  const { mutateAsync: stopAllInstances } = useMutation(
    trpc.morph.instances.stopAll.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.stats.queryKey(),
        });
      },
    })
  );
  const { mutateAsync: pauseAllInstances } = useMutation(
    trpc.morph.instances.pauseAll.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.stats.queryKey(),
        });
      },
    })
  );
  const { mutateAsync: createHetznerServer } = useMutation(
    trpc.hetzner.servers.create.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.hetzner.servers.list.queryKey(),
        }),
    })
  );
  const { mutateAsync: deleteHetznerServer } = useMutation(
    trpc.hetzner.servers.delete.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.hetzner.servers.list.queryKey(),
        }),
    })
  );
  return (
    <div className="flex flex-col items-start gap-4 p-2">
      {statsData && (
        <div className="flex w-full gap-4 rounded border p-2 font-mono text-xs">
          <div className="flex flex-col">
            <span className="text-gray-500">Snapshots</span>
            <span className="text-lg">{statsData.snapshotCount}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-gray-500">Running</span>
            <span className="text-green-500 text-lg">
              {statsData.runningInstanceCount}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-gray-500">Paused</span>
            <span className="text-blue-500 text-lg">
              {statsData.pausedInstanceCount}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-gray-500">Usage (24h)</span>
            <span className="text-lg">
              {(
                (statsData.usage.instance.cpuTime +
                  statsData.usage.instance.memoryTime +
                  statsData.usage.instance.diskTime +
                  statsData.usage.snapshot.memoryTime +
                  statsData.usage.snapshot.diskTime) *
                statsData.usage.mcuRate
              ).toFixed(2)}{" "}
              MCU
            </span>
          </div>
        </div>
      )}
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
      <div className="grid w-full grid-cols-5 gap-2 [&>div]:flex [&>div]:flex-col [&>div]:gap-1 [&_h2]:font-semibold [&_h2]:text-lg">
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
            <h2>Hetzner Templates</h2>
          </div>
          {hetznerTemplates?.map((template: HetznerTemplate) => (
            <div
              className="flex h-6 items-center justify-between gap-1 rounded border px-1 font-mono text-xs"
              key={template.id}
            >
              <div className="flex items-center gap-1 truncate">
                <span className="truncate">
                  {template.labels?.name ?? template.description}
                </span>
                <span
                  className={
                    template.status === "available"
                      ? "text-gray-500"
                      : "text-yellow-500"
                  }
                >
                  {template.status}
                </span>
              </div>
              <button
                className="text-green-500 hover:text-green-400 disabled:cursor-not-allowed disabled:text-gray-500"
                disabled={template.status !== "available"}
                onClick={() =>
                  createHetznerServer({ image: String(template.id) })
                }
                title={
                  template.status === "available"
                    ? "Create server from template"
                    : `Template ${template.status}`
                }
                type="button"
              >
                ▶
              </button>
            </div>
          ))}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2>Servers</h2>
          </div>
          {serversData?.map((server: Server) => (
            <ServerRow
              key={server.id}
              onDelete={() => deleteHetznerServer({ id: server.id })}
              server={server}
            />
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
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.stats.queryKey(),
        });
      },
    })
  );
  const { mutateAsync: deleteSnapshot } = useMutation(
    trpc.morph.snapshot.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.morph.snapshots.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.stats.queryKey(),
        });
      },
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
  const [isWaking, setIsWaking] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [progress, setProgress] = useState(0);
  const [overlayMounted, setOverlayMounted] = useState(false);
  const prevStatusRef = useRef(instance.status);
  const wakeStartTimeRef = useRef<number | null>(null);

  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const isReady = instance.status === InstanceStatus.READY;
  const isPaused = instance.status === InstanceStatus.PAUSED;
  const isPending = instance.status === InstanceStatus.PENDING;
  const shouldShowOverlay = !isReady || isWaking || !iframeLoaded;
  const progressDuration = isWaking || isPending ? "5s" : "300ms";

  const { mutateAsync: pauseInstance } = useMutation(
    trpc.morph.instance.pause.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.snapshots.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.stats.queryKey(),
        });
      },
    })
  );
  const { mutateAsync: resumeInstance } = useMutation(
    trpc.morph.instance.resume.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.stats.queryKey(),
        });
      },
    })
  );
  const { mutateAsync: stopInstance } = useMutation(
    trpc.morph.instance.stop.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.morph.instances.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.morph.stats.queryKey(),
        });
      },
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
        queryClient.invalidateQueries({
          queryKey: trpc.morph.stats.queryKey(),
        });
      },
    })
  );

  // Find the first HTTP service with a name starting with "web"
  const webService = instance.networking?.httpServices?.find((s) =>
    s.name.startsWith("web")
  );
  const webServiceUrl = webService?.url;

  // Start timing when overlay appears (paused, pending, or waking)
  useEffect(() => {
    if (shouldShowOverlay && !wakeStartTimeRef.current) {
      wakeStartTimeRef.current = Date.now();
      console.log(
        `[${instance.id}] Overlay appeared (status: ${instance.status}, isWaking: ${isWaking})`
      );
    }
  }, [shouldShowOverlay, instance.id, instance.status, isWaking]);

  // Clear waking state when instance becomes ready
  useEffect(() => {
    if (isReady) {
      if (wakeStartTimeRef.current) {
        console.log(
          `[${instance.id}] Status ready after ${Date.now() - wakeStartTimeRef.current}ms`
        );
      }
      setIsWaking(false);
    }
  }, [isReady, instance.id]);

  // EXPERIMENTAL: Pre-warm the connection when waking starts (hover to wake)
  // This attempts to establish the connection during VM boot, so it's ready when status=ready
  // Unsure of effectiveness - the request may timeout or Morph may not route until VM is ready
  useEffect(() => {
    if (isWaking && webServiceUrl) {
      // Reset timer on hover-to-wake for accurate timing
      wakeStartTimeRef.current = Date.now();
      console.log(
        `[${instance.id}] Starting pre-warm fetch to ${webServiceUrl}`
      );
      fetch(webServiceUrl, { mode: "no-cors" }).catch(() => {
        // Expected to fail or timeout while VM is booting - that's fine
      });
    }
  }, [isWaking, instance.id, webServiceUrl]);

  // Reload iframe when becoming ready, but only if it never successfully loaded
  useEffect(() => {
    const wasNotReady = prevStatusRef.current !== InstanceStatus.READY;
    if (isReady && wasNotReady && !iframeLoaded) {
      setIframeKey((k) => k + 1);
    }
    prevStatusRef.current = instance.status;
  }, [instance.status, isReady, iframeLoaded]);

  // Handle overlay mount/unmount with fade-out
  useEffect(() => {
    if (shouldShowOverlay) {
      setProgress(0);
      setOverlayMounted(true);
    } else {
      setProgress(100);
      const timer = setTimeout(() => setOverlayMounted(false), 500);
      return () => clearTimeout(timer);
    }
  }, [shouldShowOverlay]);

  // Animate progress to target when overlay is showing
  useEffect(() => {
    if (!shouldShowOverlay) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (isWaking || isPending) {
        setProgress(80);
      } else if (isPaused) {
        setProgress(20);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [shouldShowOverlay, isPaused, isWaking, isPending]);

  const handleIframeMouseEnter = async () => {
    if (isPaused && !isWaking) {
      setIsWaking(true);
      try {
        await resumeInstance({ instanceId: instance.id });
      } catch {
        setIsWaking(false);
      }
    }
  };

  const handleIframeLoad = () => {
    if (wakeStartTimeRef.current) {
      console.log(
        `[${instance.id}] Iframe loaded after ${Date.now() - wakeStartTimeRef.current}ms (total from wake start)`
      );
      wakeStartTimeRef.current = null;
    }
    setIframeLoaded(true);
  };

  const handleIframeError = () => {
    console.log(`[${instance.id}] Iframe error`);
    setIframeLoaded(false);
  };

  return (
    <div className="flex flex-col gap-1 rounded border p-1 font-mono text-xs">
      <div className="flex h-6 items-center justify-between gap-1">
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
            disabled={!isReady}
            onClick={() => pauseInstance({ instanceId: instance.id })}
            type="button"
          >
            ⏸
          </button>
          <button
            className="text-green-500 hover:text-green-400 disabled:opacity-30"
            disabled={!isPaused}
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
            disabled={!(isReady || isPaused)}
            onClick={() =>
              branchInstance({
                instanceId: instance.id,
                count: branchCount,
                resume: isPaused,
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
      {webServiceUrl && (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: wake-on-hover for paused VMs
        <div className="relative" onMouseEnter={handleIframeMouseEnter}>
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: iframe load/error handlers for retry logic */}
          <iframe
            className="h-32 w-full rounded border"
            key={iframeKey}
            onError={handleIframeError}
            onLoad={handleIframeLoad}
            src={webServiceUrl}
            title={`Instance ${instance.id} web view`}
          />
          {overlayMounted && (
            <div
              className="absolute inset-0 flex items-center justify-center rounded bg-black/60 transition-opacity duration-500"
              style={{ opacity: shouldShowOverlay ? 1 : 0 }}
            >
              <div className="h-1 w-24 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full bg-white"
                  style={{
                    width: `${progress}%`,
                    transition: `width ${progressDuration} ease-out`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ServerRow({
  server,
  onDelete,
}: {
  server: Server;
  onDelete: () => void;
}) {
  return (
    <div className="flex h-6 items-center justify-between gap-1 rounded border px-1 font-mono text-xs">
      <span className="truncate">{server.name}</span>
      <div className="flex items-center gap-1">
        <span className="text-gray-500">{server.public_net.ipv4.ip}</span>
        <button
          className="text-red-500 hover:text-red-400"
          onClick={onDelete}
          title="Delete server"
          type="button"
        >
          ×
        </button>
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
