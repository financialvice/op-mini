import { adminDb } from "@repo/db/admin";
import { initTRPC, TRPCError } from "@trpc/server";
import SuperJSON from "superjson";

export type Context = {
  token?: string;
  user?: { id: string; email?: string; refresh_token?: string };
};

export const t = initTRPC.context<Context>().create({ transformer: SuperJSON });

/**
 * Protected procedure that requires authentication.
 * Verifies the token from context and adds the user to the context.
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const { token } = ctx;
  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Missing authentication token",
    });
  }

  const user = await adminDb.db.auth.verifyToken(token);
  if (!user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid authentication token",
    });
  }

  return next({
    ctx: {
      token,
      user,
    },
  });
});

// Server-side caller for use in API routes, middleware, etc.
export const createCaller = async () => {
  const { appRouter } = await import("./app-router");
  return appRouter.createCaller({});
};
