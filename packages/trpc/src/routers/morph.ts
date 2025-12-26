import type { Snapshot } from "morphcloud";
import { MorphCloudClient } from "morphcloud";
import z from "zod";
import { t } from "../server";
import { devboxTemplate } from "./machine-templates";

// spec https://cloud.morph.so/api/openapi.json
// client https://github.com/morph-labs/morph-typescript-sdk
const morph = new MorphCloudClient({
  apiKey: "morph_k4bK5nJrMbx5oBGWs6cVGe",
});

// Helper: Get or create the morphvm-minimal base snapshot
async function getOrCreateBaseSnapshot(): Promise<Snapshot> {
  const candidates = await morph.snapshots.list({ digest: "morphvm-minimal" });
  if (candidates[0]) {
    return candidates[0];
  }
  return morph.snapshots.create({
    imageId: "morphvm-minimal",
    vcpus: 1,
    memory: 4096,
    diskSize: 16_384,
    metadata: { type: "template-base" },
    digest: "morphvm-minimal",
  });
}

// Helper: Log template creation error details
function logTemplateError(
  stepNum: number,
  totalSteps: number,
  command: string,
  error: unknown
): void {
  console.error(`[templates.create] Command ${stepNum}/${totalSteps} FAILED`);
  console.error(`[templates.create] Command: ${command}`);
  console.error("[templates.create] Error:", error);
  if (error instanceof Error) {
    console.error(`[templates.create] Error message: ${error.message}`);
    console.error(`[templates.create] Error stack: ${error.stack}`);
  }
}

// Helper: Build snapshot metadata for template step
function buildStepMetadata(opts: {
  stepNum: number;
  totalSteps: number;
  command: string;
  completedCount: number;
  template: string[];
}): Record<string, string> {
  const { stepNum, totalSteps, command, completedCount, template } = opts;
  const isLastStep = stepNum === totalSteps;
  return {
    type: isLastStep ? "template" : "template-step",
    name: "devbox",
    step: `${stepNum}/${totalSteps}`,
    command: command.slice(0, 200),
    completed: String(completedCount),
    ...(isLastStep
      ? {
          description:
            "Standard devbox with Node.js, Bun, Claude Code, Codex, pm2, tmux, uv, gh, vercel",
          commands: JSON.stringify(template),
          base: "morphvm-minimal",
        }
      : { progress: `${Math.round((stepNum / totalSteps) * 100)}%` }),
  };
}

export const morphRouter = t.router({
  templates: {
    create: t.procedure
      .input(z.object({ name: z.enum(["devbox"]) }))
      .mutation(async ({ input: _input }) => {
        const template = devboxTemplate;
        let currentSnapshot = await getOrCreateBaseSnapshot();
        let completedCount = 0;

        for (let idx = 0; idx < template.length; idx++) {
          const command = template[idx];
          if (!command) {
            continue;
          }

          const stepNum = idx + 1;
          const totalSteps = template.length;

          console.log(
            `[templates.create] Running command ${stepNum}/${totalSteps}: ${command.slice(0, 80)}...`
          );

          try {
            currentSnapshot = await currentSnapshot.setup(command);
            completedCount++;
            await currentSnapshot.setMetadata(
              buildStepMetadata({
                stepNum,
                totalSteps,
                command,
                completedCount,
                template,
              })
            );
            console.log(
              `[templates.create] Command ${stepNum} succeeded, snapshot: ${currentSnapshot.id}`
            );
          } catch (error) {
            logTemplateError(stepNum, totalSteps, command, error);
            throw new Error(
              `Template setup failed at step ${stepNum}: ${command.slice(0, 100)}... - ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }),
  },
  snapshots: {
    // list all snapshots
    list: t.procedure
      .input(
        z
          .object({
            metadata: z.record(z.string(), z.string()).optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const snapshots = await morph.snapshots.list({
          metadata: input?.metadata,
        });
        return { snapshots: snapshots.map((snapshot) => ({ ...snapshot })) };
      }),
    // create a new snapshot
    create: t.procedure.mutation(async () => {
      const snapshot = await morph.snapshots.create({
        vcpus: 2,
        memory: 4096,
        diskSize: 8192,
        metadata: {
          type: "blank",
        },
      });
      return { ...snapshot };
    }),
  },
  snapshot: {
    // delete a snapshot (gone forever)
    delete: t.procedure
      .input(z.object({ snapshotId: z.string() }))
      .mutation(async ({ input }) =>
        (await morph.snapshots.get({ snapshotId: input.snapshotId })).delete()
      ),
  },
  instances: {
    // full overwrite of metadata
    setMetadata: t.procedure
      .input(
        z.object({
          instanceId: z.string(),
          metadata: z.record(z.string(), z.string()),
        })
      )
      .mutation(async ({ input }) => {
        await morph.instances
          .get({ instanceId: input.instanceId })
          .then((instance) => instance.setMetadata(input.metadata));
      }),
    // list all instances
    // metadata filter is optional, exact match only, all specified keys must match
    list: t.procedure
      .input(
        z
          .object({
            metadata: z.record(z.string(), z.string()).optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const instances = await morph.instances.list({
          metadata: input?.metadata,
        });
        return { instances: instances.map((instance) => ({ ...instance })) };
      }),
    // create a new instance
    create: t.procedure.mutation(async () => {
      const snapshot = await morph.snapshots.create({
        vcpus: 2,
        memory: 4096,
        diskSize: 8192,
        metadata: {
          type: "blank",
        },
      });
      const instance = await morph.instances.start({ snapshotId: snapshot.id });
      return { ...instance };
    }),
    // stop (delete) all instances, gone forever
    stopAll: t.procedure.mutation(async () => {
      const instances = await morph.instances.list();
      await Promise.all(
        instances.map((instance) =>
          morph.instances.stop({ instanceId: instance.id })
        )
      );
    }),
    // pause all instances
    pauseAll: t.procedure.mutation(async () => {
      const instances = await morph.instances.list();
      await Promise.all(
        instances.map((instance) =>
          morph.POST(`/instance/${instance.id}/pause`, {
            snapshot: false,
          })
        )
      );
    }),
  },
  instance: {
    // start an instance from a snapshot
    start: t.procedure
      .input(
        z.object({
          snapshotId: z.string(),
          metadata: z.record(z.string(), z.string()).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const instance = await morph.instances.start({
          snapshotId: input.snapshotId,
          metadata: input.metadata,
          ttlAction: "pause",
          ttlSeconds: 120,
        });

        await instance.waitUntilReady(30);

        return {
          instanceId: instance.id,
          status: instance.status,
        };
      }),
    // stop (delete) an instance, gone forever
    stop: t.procedure
      .input(z.object({ instanceId: z.string() }))
      .mutation(async ({ input }) =>
        morph.instances.stop({ instanceId: input.instanceId })
      ),
    // pause an instance, can be resumed
    pause: t.procedure
      .input(z.object({ instanceId: z.string() }))
      .mutation(async ({ input }) =>
        morph.POST(`/instance/${input.instanceId}/pause`, {
          snapshot: false,
        })
      ),
    // resume a paused instance
    resume: t.procedure
      .input(z.object({ instanceId: z.string() }))
      .mutation(async ({ input }) =>
        morph.POST(`/instance/${input.instanceId}/resume`)
      ),
    // refresh TTL to keep instance alive (query so we can use refetchInterval)
    refreshTtl: t.procedure
      .input(
        z.object({
          instanceId: z.string(),
          ttlSeconds: z.number().default(60),
        })
      )
      .query(async ({ input }) => {
        try {
          const result = await morph.POST(`/instance/${input.instanceId}/ttl`, {
            ttl_seconds: input.ttlSeconds,
            ttl_action: "pause",
          });

          return result;
        } catch (err) {
          console.error("[refreshTtl] error:", err);
          throw err;
        }
      }),
    // branch an instance, if paused must pass resume=true in order to resume prior to branching
    // for count=n, will create n new ready instances
    branch: t.procedure
      .input(
        z.object({
          instanceId: z.string(),
          count: z.number().int().positive().optional().default(1),
          resume: z.boolean().optional().default(false),
        })
      )
      .mutation(async ({ input }) => {
        if (input.resume) {
          await morph.POST(`/instance/${input.instanceId}/resume`);
        }
        const response = await morph.POST(
          `/instance/${input.instanceId}/branch`,
          {
            count: input.count,
          },
          {
            snapshot_metadata: {},
            instance_metadata: {},
          }
        );

        const parsed = z
          .object({
            snapshot: z.object({ id: z.string() }),
            instances: z.array(
              z.object({ id: z.string(), status: z.string() })
            ),
          })
          .parse(response);

        return {
          snapshot: parsed.snapshot,
          instances: parsed.instances,
        };
      }),
  },
  stats: t.procedure.query(async () => {
    const MCU_RATE = 0.05; // $0.05 per MCU

    const [usageResponse, snapshots, instances] = await Promise.all([
      morph.GET("/user/usage", { interval: "24h" }) as Promise<{
        instance: Array<{
          instance_cpu_time: number;
          instance_memory_time: number;
          instance_disk_time: number;
        }>;
        snapshot: Array<{
          snapshot_memory_time: number;
          snapshot_disk_time: number;
        }>;
      }>,
      morph.snapshots.list({}),
      morph.instances.list(),
    ]);

    // Calculate total MCU from usage data
    const instanceUsage = usageResponse.instance.reduce(
      (acc, item) => ({
        cpuTime: acc.cpuTime + (item.instance_cpu_time ?? 0),
        memoryTime: acc.memoryTime + (item.instance_memory_time ?? 0),
        diskTime: acc.diskTime + (item.instance_disk_time ?? 0),
      }),
      { cpuTime: 0, memoryTime: 0, diskTime: 0 }
    );

    const snapshotUsage = usageResponse.snapshot.reduce(
      (acc, item) => ({
        memoryTime: acc.memoryTime + (item.snapshot_memory_time ?? 0),
        diskTime: acc.diskTime + (item.snapshot_disk_time ?? 0),
      }),
      { memoryTime: 0, diskTime: 0 }
    );

    // Count instances by status
    const runningInstances = instances.filter(
      (i) => i.status === "ready"
    ).length;
    const pausedInstances = instances.filter(
      (i) => i.status === "paused"
    ).length;

    return {
      usage: {
        instance: instanceUsage,
        snapshot: snapshotUsage,
        mcuRate: MCU_RATE,
      },
      snapshotCount: snapshots.length,
      runningInstanceCount: runningInstances,
      pausedInstanceCount: pausedInstances,
      totalInstanceCount: instances.length,
    };
  }),
});
