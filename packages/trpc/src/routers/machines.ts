import { adminDb } from "@repo/db/admin";
import { MorphCloudClient } from "morphcloud";
import z from "zod";
import { t } from "../server";

const morph = new MorphCloudClient({
  apiKey: "morph_k4bK5nJrMbx5oBGWs6cVGe",
});

export const machinesRouter = t.router({
  reconcile: t.procedure
    .input(
      z.object({
        machineId: z.string(),
        morphInstanceId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const morphStatus = await morph.instances.get({
          instanceId: input.morphInstanceId,
        });

        return { status: morphStatus.status };
      } catch (error) {
        // Check if this is a 404 Not Found error (instance deleted/not found)
        if (
          error instanceof Error &&
          error.message.includes("404") &&
          error.message.includes("InstanceNotFoundError")
        ) {
          // Clear the morphInstanceId from the machine entity
          await adminDb.db.transact([
            adminDb.db.tx.machines[input.machineId]!.update({
              morphInstanceId: null,
            }),
          ]);
          return { status: "not_found", cleared: true };
        }

        return { status: "error" };
      }
    }),
});
