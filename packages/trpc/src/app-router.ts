import { authRouter } from "./routers/auth";
import { helloRouter } from "./routers/hello";
import { t } from "./server";

export const appRouter = t.router({
  auth: authRouter,
  hello: helloRouter,
});

export type AppRouter = typeof appRouter;
