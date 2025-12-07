import { authRouter } from "./routers/auth";
import { helloRouter } from "./routers/hello";
import { hetznerRouter } from "./routers/hetzner";
import { machinesRouter } from "./routers/machines";
import { morphRouter } from "./routers/morph";
import { t } from "./server";

export const appRouter = t.router({
  auth: authRouter,
  hello: helloRouter,
  hetzner: hetznerRouter,
  morph: morphRouter,
  machines: machinesRouter,
});

export type AppRouter = typeof appRouter;
