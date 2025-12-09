import { id } from "@instantdb/core";
import { PlatformApi } from "@instantdb/platform";
import { adminDb } from "@repo/db/admin";
import z from "zod";
import { protectedProcedure, t } from "../server";

const INSTANT_API = "https://api.instantdb.com";

const platformApi = new PlatformApi({
  auth: { token: process.env.INSTANT_PLATFORM_TOKEN! },
});

const dashFetch = async <T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> => {
  const res = await fetch(`${INSTANT_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.INSTANT_DASH_TOKEN!}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(error.message ?? "InstantDB API error");
  }
  return res.json() as T;
};

const OrgResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const instantdbRouter = t.router({
  teams: {
    // create team on backend so that we can auto-create and link instantdb org (requires dash token)
    create: protectedProcedure
      .input(z.object({ name: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const data = await dashFetch<{
          org: z.infer<typeof OrgResponseSchema>;
        }>("/dash/orgs", {
          method: "POST",
          body: JSON.stringify({ title: input.name }),
        });

        const teamId = id();
        const membershipId = id();
        const orgId = id();
        await adminDb.db.asUser({ token: ctx.token }).transact([
          adminDb.db.tx.teams[teamId]!.create({
            name: input.name,
            createdAt: new Date(),
          }),
          adminDb.db.tx.teamMemberships[membershipId]!.create({
            role: "owner",
            createdAt: new Date(),
          }).link({ team: teamId, user: ctx.user.id }),
          adminDb.db.tx.instantDbOrgs[orgId]!.create({
            externalOrgId: data.org.id,
            name: input.name,
            createdAt: new Date(),
          }).link({ team: teamId }),
        ]);
      }),
  },

  apps: {
    // create app on backend because it requires plat token
    create: protectedProcedure
      .input(
        z.object({
          teamId: z.string(),
          orgId: z.string(),
          externalOrgId: z.string(),
          name: z.string(),
          description: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const appId = id();

        const { app: externalApp } = await platformApi.createApp({
          // when viewed from InstantDB the only thing that matters is relating to our appId
          title: appId,
          orgId: input.externalOrgId,
        });

        await adminDb.db.asUser({ token: ctx.token }).transact([
          adminDb.db.tx.instantDbApps[appId]!.create({
            externalAppId: externalApp.id,
            adminToken: externalApp.adminToken,
            name: input.name,
            description: input.description,
            createdAt: new Date(),
          })
            .link({ team: input.teamId })
            .link({ org: input.orgId }),
        ]);
      }),
    // delete app on backend because it requires plat token
    delete: protectedProcedure
      .input(z.object({ externalAppId: z.string() }))
      .mutation(async ({ input }) => {
        await platformApi.deleteApp(input.externalAppId);
      }),
  },
});
