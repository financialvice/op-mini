import { authRouter } from "./routers/auth";
import { claudeRouter } from "./routers/claude";
import { helloRouter } from "./routers/hello";
import { hetznerRouter } from "./routers/hetzner";
import { instantdbRouter } from "./routers/instantdb";
import { machinesRouter } from "./routers/machines";
import { morphRouter } from "./routers/morph";
import { oauthRouter } from "./routers/oauth";
import { sessionsRouter } from "./routers/sessions";
import { t } from "./server";

export const appRouter = t.router({
  auth: authRouter,
  claude: claudeRouter,
  hello: helloRouter,
  hetzner: hetznerRouter,
  instantdb: instantdbRouter,
  morph: morphRouter,
  machines: machinesRouter,
  oauth: oauthRouter,
  sessions: sessionsRouter,
});

export type AppRouter = typeof appRouter;
