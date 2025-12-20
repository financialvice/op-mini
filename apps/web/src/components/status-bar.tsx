"use client";

import { useTRPC } from "@repo/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { Gauge, Layers, Pause, Play } from "lucide-react";

export function StatusBar() {
  const trpc = useTRPC();
  const { data: stats } = useQuery({
    ...trpc.morph.stats.queryOptions(),
    refetchInterval: 5000,
  });

  if (!stats) {
    return null;
  }

  const totalUsage = (
    (stats.usage.instance.cpuTime +
      stats.usage.instance.memoryTime +
      stats.usage.instance.diskTime +
      stats.usage.snapshot.memoryTime +
      stats.usage.snapshot.diskTime) *
    stats.usage.mcuRate
  ).toFixed(2);

  return (
    <div className="z-9999 flex h-6 items-center gap-2 border-t bg-background px-3 font-mono text-xs">
      <div className="flex items-center gap-1" title="Snapshots">
        <Layers className="h-3 w-3 text-muted-foreground" />
        <span>{stats.snapshotCount}</span>
      </div>
      <div className="flex items-center gap-1" title="Running">
        <Play className="h-3 w-3 text-green-500" />
        <span className="text-green-500">{stats.runningInstanceCount}</span>
      </div>
      <div className="flex items-center gap-1" title="Paused">
        <Pause className="h-3 w-3 text-blue-500" />
        <span className="text-blue-500">{stats.pausedInstanceCount}</span>
      </div>
      <div className="flex items-center gap-1" title="Usage (24h)">
        <Gauge className="h-3 w-3 text-muted-foreground" />
        <span>{totalUsage} MCU</span>
      </div>
    </div>
  );
}
