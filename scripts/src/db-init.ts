#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const REPO_ROOT = process.cwd();

const ENV_TARGETS = [
  { path: "apps/mobile/.env", prefix: "EXPO_PUBLIC" },
  { path: "apps/web/.env", prefix: "NEXT_PUBLIC" },
  { path: "apps/task-runner/.env", prefix: "" },
  { path: "packages/db/.env", prefix: "" },
];

// Regex for parsing JSON from instant-cli output
const JSON_PATTERN = /\{[\s\S]*\}/;

async function createApp(
  title: string
): Promise<{ appId: string; adminToken: string }> {
  console.log("Creating new InstantDB app...");

  // Use init-without-files for non-interactive app creation
  const result =
    await $`bunx instant-cli@latest init-without-files --title ${title} -y`.text();

  // Parse JSON output
  try {
    // Extract JSON from output (may have extra text)
    const jsonMatch = result.match(JSON_PATTERN);
    if (!jsonMatch) {
      throw new Error("No JSON found in output");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.error) {
      throw new Error(`InstantDB error: ${parsed.error}`);
    }

    if (!(parsed.app?.appId && parsed.app?.adminToken)) {
      throw new Error("Missing appId or adminToken in response");
    }

    return {
      appId: parsed.app.appId,
      adminToken: parsed.app.adminToken,
    };
  } catch (error) {
    console.error("Failed to parse instant-cli output:");
    console.error(result);
    throw error;
  }
}

async function updateEnvFile(
  filePath: string,
  appId: string,
  adminToken: string,
  prefix: string
): Promise<void> {
  const fullPath = join(REPO_ROOT, filePath);
  let content = "";

  // Read existing content if file exists
  if (existsSync(fullPath)) {
    content = await readFile(fullPath, "utf-8");
  } else {
    // Create directory if it doesn't exist
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
  }

  // Build new env vars
  const envVars: string[] = [];

  if (prefix) {
    // Client-side env vars (web/mobile)
    const appIdKey = `${prefix}_INSTANT_APP_ID`;
    const adminTokenKey = "INSTANT_APP_ADMIN_TOKEN";
    envVars.push(`${appIdKey}=${appId}`);
    envVars.push(`${adminTokenKey}=${adminToken}`);
  } else {
    // Server-side env vars (task-runner/db)
    envVars.push(`NEXT_PUBLIC_INSTANT_APP_ID=${appId}`);
    envVars.push(`INSTANT_APP_ADMIN_TOKEN=${adminToken}`);
  }

  // Remove existing INSTANT_* vars from content
  const lines = content.split("\n").filter((line) => {
    const trimmed = line.trim();
    return !(
      trimmed.startsWith("INSTANT_APP_ID=") ||
      trimmed.startsWith("INSTANT_APP_ADMIN_TOKEN=") ||
      trimmed.startsWith("NEXT_PUBLIC_INSTANT_APP_ID=") ||
      trimmed.startsWith("INSTANT_APP_ADMIN_TOKEN=") ||
      trimmed.startsWith("EXPO_PUBLIC_INSTANT_APP_ID=") ||
      trimmed.startsWith("INSTANT_APP_ADMIN_TOKEN=")
    );
  });

  // Add new vars
  const newContent = `${[...lines, ...envVars].filter(Boolean).join("\n")}\n`;

  await writeFile(fullPath, newContent, "utf-8");
  console.log(`✓ Updated ${filePath}`);
}

async function pushSchema(appId: string): Promise<void> {
  console.log("\nPushing schema and permissions to InstantDB...");

  const dbDir = join(REPO_ROOT, "packages/db");
  await $`cd ${dbDir} && bunx instant-cli push all -a ${appId} -y`;

  console.log("✓ Schema and permissions pushed");
}

async function main() {
  try {
    // Get app title from args or use default
    const title = process.argv[2] || "Camono";

    console.log("🚀 Initializing InstantDB\n");

    // Create the app
    const { appId, adminToken } = await createApp(title);

    console.log(`\n✓ Created app: ${title}`);
    console.log(`  App ID: ${appId}`);
    console.log(`  Admin Token: ${adminToken.substring(0, 10)}...`);

    // Update all env files
    console.log("\nUpdating .env files...");
    for (const target of ENV_TARGETS) {
      await updateEnvFile(target.path, appId, adminToken, target.prefix);
    }

    // Push schema and perms
    await pushSchema(appId);

    console.log("\n✅ Database initialization complete!");
    console.log("\nYour new InstantDB app is ready to use.");
    console.log(
      "Run your apps with `bun run dev` to start using the database.\n"
    );
  } catch (error) {
    console.error("\n❌ Error initializing database:");
    console.error(error);
    process.exit(1);
  }
}

main();
