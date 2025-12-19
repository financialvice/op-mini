import type { Instance, Snapshot } from "morphcloud";
import { type InstanceExecResponse, MorphCloudClient } from "morphcloud";
import z from "zod";
import { t } from "../server";
import { devboxTemplate } from "./machine-templates";

// spec https://cloud.morph.so/api/openapi.json
// client https://github.com/morph-labs/morph-typescript-sdk
const morph = new MorphCloudClient({
  apiKey: "morph_k4bK5nJrMbx5oBGWs6cVGe",
});

export const morphRouter = t.router({
  templates: {
    create: t.procedure
      .input(
        z.object({
          name: z.enum(["devbox"]),
        })
      )
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fix later once we know goal
      .mutation(async ({ input }) => {
        const template = devboxTemplate;
        let buildSnapshot: Snapshot | null = null;
        let instance: Instance | null = null;
        const commandResults: InstanceExecResponse[] = [];

        try {
          buildSnapshot = await morph.snapshots.create({
            imageId: "morphvm-minimal",
            vcpus: 2,
            memory: 4096,
            diskSize: 8192,
            metadata: {
              type: "template-build",
              name: input.name,
            },
          });

          instance = await morph.instances.start({
            snapshotId: buildSnapshot.id,
            ttlSeconds: 1800, // 30 minutes
            ttlAction: "pause", // delete
            metadata: {
              type: "template-build",
              name: input.name,
            },
          });

          await instance.waitUntilReady(30); // 30s timeout
          await instance.exposeHttpService("web", 3000);
          await instance.exposeHttpService("wake", 42_069);
          await instance.exposeHttpService("agent", 3456);
          await instance.setWakeOn(true, true); // wake on ssh, wake on http

          for (let i = 0; i < template.length; i++) {
            const command = template[i] as string;
            const result = await instance.exec(command, { timeout: 600 }); // 10 min timeout

            commandResults.push(result);

            if (result.exit_code !== 0) {
              try {
                await instance.stop();
              } catch {
                // ignore cleanup errors
              }
              try {
                await buildSnapshot.delete();
              } catch {
                // ignore cleanup errors
              }

              return {
                success: false,
                error: {
                  message: `command failed at index ${i}`,
                  failedCommand: command,
                  exitCode: result.exit_code,
                  stderr: result.stderr,
                  stdout: result.stdout,
                },
                commandResults,
                templateSnapshot: null,
              };
            }
          }

          // all commands succeeded - create final template snapshot
          await instance.setMetadata({
            type: "template",
            name: input.name,
            commands: JSON.stringify(template),
            createdAt: new Date().toISOString(),
          });

          await instance.setTTL(60, "pause"); // 60 second ttl

          await morph.POST(`/instance/${instance.id}/pause`, {
            snapshot: false,
          });

          await buildSnapshot.delete();

          return {
            success: true,
            error: null,
            commandResults,
            templateInstance: {
              id: instance.id,
              status: instance.status,
              metadata: instance.metadata,
            },
          };
        } catch (error) {
          if (instance) {
            try {
              await instance.stop();
            } catch {
              // ignore cleanup errors
            }
          }
          if (buildSnapshot) {
            try {
              await buildSnapshot.delete();
            } catch {
              // ignore cleanup errors
            }
          }

          throw error;
        }
      }),
  },
  snapshots: {
    // list all snapshots
    list: t.procedure.query(async () => {
      const snapshots = await morph.snapshots.list({});
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
      .mutation(async ({ input }) => {
        await (
          await morph.snapshots.get({ snapshotId: input.snapshotId })
        ).delete();
      }),
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
          .object({ metadata: z.record(z.string(), z.string()).optional() })
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
      .input(z.object({ snapshotId: z.string() }))
      .mutation(async ({ input }) => {
        await morph.instances.start({ snapshotId: input.snapshotId });
      }),
    // stop (delete) an instance, gone forever
    stop: t.procedure
      .input(z.object({ instanceId: z.string() }))
      .mutation(async ({ input }) => {
        await morph.instances.stop({ instanceId: input.instanceId });
      }),
    // pause an instance, can be resumed
    pause: t.procedure
      .input(z.object({ instanceId: z.string() }))
      .mutation(async ({ input }) => {
        await morph.POST(`/instance/${input.instanceId}/pause`, {
          snapshot: false,
        });
      }),
    // resume a paused instance
    resume: t.procedure
      .input(z.object({ instanceId: z.string() }))
      .mutation(async ({ input }) => {
        await morph.POST(`/instance/${input.instanceId}/resume`);
      }),
    // refresh TTL to keep instance alive (query so we can use refetchInterval)
    refreshTtl: t.procedure
      .input(
        z.object({ instanceId: z.string(), ttlSeconds: z.number().default(60) })
      )
      .query(async ({ input }) => {
        try {
          const result = await morph.POST(
            `/instance/${input.instanceId}/ttl`,
            {}, // query params
            { ttl_seconds: input.ttlSeconds, ttl_action: "pause" } // body
          );

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
        return z
          .object({
            snapshot: z.object({ id: z.string() }),
            instances: z.array(
              z.object({ id: z.string(), status: z.string() })
            ),
          })
          .parse(response);
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
