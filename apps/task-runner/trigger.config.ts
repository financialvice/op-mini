import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { captureException, init } from "@sentry/node";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_kouazajdzmlaurllunyf",
  dirs: ["./src/trigger"],
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10_000,
      factor: 2,
      randomize: true,
    },
  },
  maxDuration: 3600,
  machine: "medium-2x",
  build: {
    external: ["@anthropic-ai/claude-agent-sdk", "ssh2"],
    extensions: [
      esbuildPlugin(
        sentryEsbuildPlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
        }),
        { placement: "last", target: "deploy" }
      ),
    ],
  },
  init: () => {
    init({
      defaultIntegrations: false,
      dsn: process.env.SENTRY_DSN,
      environment:
        process.env.NODE_ENV === "production" ? "production" : "development",
    });
  },
  onFailure: ({ payload, error, ctx }) => {
    captureException(error, {
      extra: {
        payload,
        ctx,
      },
    });
  },
});
