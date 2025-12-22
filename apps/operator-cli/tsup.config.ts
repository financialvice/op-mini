import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  target: "node20",
  banner: { js: "#!/usr/bin/env bun" },
  clean: true,
});
