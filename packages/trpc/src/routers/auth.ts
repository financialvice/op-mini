import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../server";

const isDevAuthEnabled =
  process.env.NODE_ENV === "development" && process.env.BYPASS_AUTH === "true";

export const authRouter = t.router({
  /**
   * Dev-only endpoint to sign in without email verification.
   * Creates a token that can be used with db.auth.signInWithToken()
   * Enabled when NODE_ENV=development or BYPASS_AUTH=true
   */
  devSignIn: t.procedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      if (!isDevAuthEnabled) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Dev sign-in is only available in development mode",
        });
      }

      // Lazy import to avoid loading admin SDK in production bundles
      const { adminDb } = await import("@repo/db/admin");
      const token = await adminDb.db.auth.createToken({ email: input.email });

      return { token };
    }),
});
