#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import sortPackageJson from "sort-package-json";

const REPO_ROOT = process.cwd();

// custom sort order with scripts right after name, version, private
const customOrder = [
  "name",
  "version",
  "private",
  "scripts",
  "workspaces",
  "type",
  "main",
  "module",
  "browser",
  "exports",
  "types",
  "typings",
  "files",
  "bin",
  "directories",
  "man",
  "repository",
  "bugs",
  "homepage",
  "keywords",
  "author",
  "contributors",
  "license",
  "funding",
  "engines",
  "packageManager",
  "os",
  "cpu",
  "config",
  "publishConfig",
  "overrides",
  "resolutions",
  "peerDependencies",
  "peerDependenciesMeta",
  "optionalDependencies",
  "dependencies",
  "devDependencies",
  "bundleDependencies",
  "bundledDependencies",
];

async function collectPackageFiles(): Promise<string[]> {
  const patterns = [
    "package.json",
    "apps/*/package.json",
    "packages/*/package.json",
  ];

  const files: string[] = [];
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan({ cwd: REPO_ROOT })) {
      files.push(join(REPO_ROOT, file));
    }
  }

  return files;
}

function processFile(
  file: string,
  checkOnly: boolean
): { isSorted: boolean; relativePath: string } {
  const relativePath = file.replace(`${REPO_ROOT}/`, "");
  const content = readFileSync(file, "utf-8");
  const sorted = sortPackageJson(content, { sortOrder: customOrder });

  const isSorted = content === sorted;

  if (!isSorted) {
    if (checkOnly) {
      console.log(relativePath);
    } else {
      writeFileSync(file, sorted, "utf-8");
      console.log(`✓ ${relativePath} sorted`);
    }
  }

  return { isSorted, relativePath };
}

function printSummary(
  totalFiles: number,
  sortedCount: number,
  alreadySortedCount: number,
  checkOnly: boolean
): void {
  console.log(`\nFound ${totalFiles} files.`);

  if (sortedCount > 0) {
    const message = checkOnly
      ? `${sortedCount} file${sortedCount !== 1 ? "s were" : " was"} not sorted.`
      : `${sortedCount} file${sortedCount !== 1 ? "s" : ""} successfully sorted.`;
    console.log(message);
  }

  if (alreadySortedCount > 0) {
    console.log(
      `${alreadySortedCount} file${alreadySortedCount !== 1 ? "s were" : " was"} already sorted.`
    );
  }
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const files = await collectPackageFiles();

  let sortedCount = 0;
  let alreadySortedCount = 0;

  for (const file of files) {
    const { isSorted } = processFile(file, checkOnly);
    if (isSorted) {
      alreadySortedCount++;
    } else {
      sortedCount++;
    }
  }

  printSummary(files.length, sortedCount, alreadySortedCount, checkOnly);

  if (checkOnly && sortedCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error sorting package.json files:", error);
  process.exit(1);
});
