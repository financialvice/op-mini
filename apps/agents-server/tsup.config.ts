import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as const,
  dts: true,
  sourcemap: true,
  target: "node20" as const,
  external: [
    "@anthropic-ai/claude-agent-sdk",
    "@openai/codex-sdk",
    "elysia",
    "@elysiajs/cors",
    "@sinclair/typebox",
  ],
};

export default defineConfig([
  // CLI entry with shebang
  {
    ...shared,
    entry: { index: "src/index.ts" },
    banner: { js: "#!/usr/bin/env bun" },
    clean: true,
  },
  // Library entries (no shebang)
  {
    ...shared,
    entry: {
      models: "src/models.ts",
      types: "src/types.ts",
    },
    clean: false, // Don't clean, index build already did
  },
]);
