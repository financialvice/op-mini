#!/usr/bin/env bun

import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const components = [
  "accordion",
  "avatar",
  "button",
  "card",
  "checkbox",
  "chip",
  "dialog",
  "divider",
  "drop-shadow-view",
  "error-view",
  "form-field",
  "popover",
  // "pressable-feedback" is not exported from heroui-native (internal component)
  "radio-group",
  "scroll-shadow",
  "select",
  "skeleton-group",
  "skeleton",
  "spinner",
  "surface",
  "switch",
  "tabs",
  "text-field",
];

const BASE_URL =
  "https://raw.githubusercontent.com/heroui-inc/heroui-native/beta/src/components";
const OUTPUT_DIR = join(import.meta.dir, "src", "native-mobile");

async function downloadDocs() {
  console.log("📥 Downloading component documentation...\n");

  for (const component of components) {
    const url = `${BASE_URL}/${component}/${component}.md`;
    const componentDir = join(OUTPUT_DIR, component);

    try {
      // Create component directory
      await mkdir(componentDir, { recursive: true });

      // Download markdown file
      console.log(`  Downloading ${component}.md...`);
      const response = await fetch(url);

      if (!response.ok) {
        console.error(
          `  ❌ Failed to download ${component}.md (${response.status})`
        );
        continue;
      }

      const content = await response.text();
      const mdPath = join(componentDir, `${component}.md`);
      await writeFile(mdPath, content, "utf-8");

      // Create AGENTS.md with the same content
      const agentsMdPath = join(componentDir, "AGENTS.md");
      await writeFile(agentsMdPath, content, "utf-8");

      // Create CLAUDE.md as a symlink to AGENTS.md
      const claudeMdPath = join(componentDir, "CLAUDE.md");
      try {
        await symlink("AGENTS.md", claudeMdPath);
      } catch {
        // Symlink might already exist, ignore error
      }

      console.log(`  ✅ ${component}.md downloaded`);
    } catch (error) {
      console.error(`  ❌ Error downloading ${component}:`, error);
    }
  }

  console.log("\n✨ Documentation download complete!\n");
}

function extractNamedExports(content: string): string[] {
  const namedExports: string[] = [];
  const namedExportRegex = /export\s+\{([^}]+)\}\s+from/g;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: needed for regex matching
  while ((match = namedExportRegex.exec(content)) !== null) {
    if (!match[1]) {
      continue;
    }
    const exports = match[1]
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    for (const exp of exports) {
      const parts = exp.split(" as ").map((p) => p.trim());
      if (parts.length === 2 && parts[1]) {
        namedExports.push(parts[1]);
      } else if (parts[0]) {
        namedExports.push(parts[0]);
      }
    }
  }

  return namedExports;
}

function extractTypeExports(content: string): string[] {
  const typeExports: string[] = [];
  const typeExportRegex = /export\s+type\s+\{([^}]+)\}\s+from/g;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: needed for regex matching
  while ((match = typeExportRegex.exec(content)) !== null) {
    if (!match[1]) {
      continue;
    }
    const exports = match[1]
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    typeExports.push(...exports);
  }

  return typeExports;
}

function generateReExportContent(
  namedExports: string[],
  typeExports: string[]
): string {
  let reExport = "";

  if (namedExports.length > 0) {
    reExport += `export { ${namedExports.join(", ")} } from "heroui-native";\n`;
  }

  if (typeExports.length > 0) {
    reExport += `export type { ${typeExports.join(", ")} } from "heroui-native";\n`;
  }

  if (reExport === "") {
    reExport = `export * from "heroui-native";\n`;
  }

  return reExport;
}

async function generateReExports() {
  console.log("📝 Generating re-export files...\n");

  const tmpDir = join(import.meta.dir, "..", "..", "tmp", "heroui-native");

  for (const component of components) {
    const componentDir = join(OUTPUT_DIR, component);

    try {
      // Read the component's index.ts from the cloned repo to get exports
      const indexPath = join(
        tmpDir,
        "src",
        "components",
        component,
        "index.ts"
      );

      let indexContent: string;
      try {
        const { readFile } = await import("node:fs/promises");
        indexContent = await readFile(indexPath, "utf-8");
      } catch {
        console.log(
          `  ⚠️  No index.ts found for ${component}, using wildcard export`
        );
        const reExport = `export * from "heroui-native";\n`;
        const tsxPath = join(componentDir, `${component}.tsx`);
        await writeFile(tsxPath, reExport, "utf-8");
        console.log(`  ✅ ${component}.tsx created (wildcard)`);
        continue;
      }

      // Extract exports and generate re-export content
      const namedExports = extractNamedExports(indexContent);
      const typeExports = extractTypeExports(indexContent);
      const reExport = generateReExportContent(namedExports, typeExports);

      const tsxPath = join(componentDir, `${component}.tsx`);
      await writeFile(tsxPath, reExport, "utf-8");
      console.log(`  ✅ ${component}.tsx created`);
    } catch (error) {
      console.error(`  ❌ Error creating ${component}.tsx:`, error);
    }
  }

  console.log("\n✨ Re-export generation complete!\n");
}

async function main() {
  console.log("🚀 Setting up HeroUI Native components\n");
  console.log("=".repeat(50));
  console.log();

  await downloadDocs();
  await generateReExports();

  console.log("=".repeat(50));
  console.log("🎉 All done! Components are ready to use.");
}

main().catch(console.error);
