import { initTRPC } from "@trpc/server";
import SuperJSON from "superjson";

export const t = initTRPC.create({ transformer: SuperJSON });

// Server-side caller for use in API routes, middleware, etc.
export const createCaller = async () => {
  const { appRouter } = await import("./app-router");
  return appRouter.createCaller({});
};
