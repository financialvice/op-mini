import { authRouter } from "./routers/auth";
import { babyCanvasRouter } from "./routers/baby-canvas";
import { claudeRouter } from "./routers/claude";
import { codexRouter } from "./routers/codex";
import { flyRouter } from "./routers/fly";
import { geminiRouter } from "./routers/gemini";
import { helloRouter } from "./routers/hello";
import { hetznerRouter } from "./routers/hetzner";
import { instantdbRouter } from "./routers/instantdb";
import { machinesRouter } from "./routers/machines";
import { morphRouter } from "./routers/morph";
import { oauthRouter } from "./routers/oauth";
import { sessionsRouter } from "./routers/sessions";
import { simpClaudeRouter } from "./routers/simp-claude";
import { t } from "./server";

export const appRouter = t.router({
  auth: authRouter,
  babyCanvas: babyCanvasRouter,
  claude: claudeRouter,
  codex: codexRouter,
  fly: flyRouter,
  gemini: geminiRouter,
  hello: helloRouter,
  hetzner: hetznerRouter,
  instantdb: instantdbRouter,
  machines: machinesRouter,
  morph: morphRouter,
  oauth: oauthRouter,
  sessions: sessionsRouter,
  simpClaude: simpClaudeRouter,
});

export type AppRouter = typeof appRouter;
