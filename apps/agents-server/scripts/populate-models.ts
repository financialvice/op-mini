#!/usr/bin/env bun

/**
 * Generates src/models.ts by extracting models from actual SDK sources:
 * - Claude: Uses the Agent SDK's supportedModels() API
 * - Codex: Fetches codex-rs/common/src/model_presets.rs from GitHub
 *
 * We use numeric reasoning levels (0-4) for natural ordering:
 * - 0: None (Codex: minimal, Claude: 0 tokens)
 * - 1: Low (Codex: low, Claude: 4000 tokens)
 * - 2: Medium (Codex: medium, Claude: 10000 tokens)
 * - 3: High (Codex: high, Claude: 20000 tokens)
 * - 4: Max (Codex: xhigh, Claude: 32000 tokens)
 *
 * Run: bun run scripts/populate-models.ts
 */

import { writeFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

const CODEX_PRESETS_URL =
  "https://raw.githubusercontent.com/openai/codex/main/codex-rs/common/src/model_presets.rs";
const OUTPUT_FILE = "src/models.ts";

// Our numeric reasoning levels
type ReasoningLevel = 0 | 1 | 2 | 3 | 4;

// Codex provider-specific levels from their Rust source
type CodexReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

// Map Codex string levels to our numeric levels
const CODEX_TO_LEVEL: Record<CodexReasoningEffort, ReasoningLevel> = {
  none: 0,
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
};

type ModelInfo = {
  value: string;
  displayName: string;
  supportedReasoningLevels: ReasoningLevel[];
};

// "gpt-5.1-codex-max" -> "GPT 5.1 Codex Max"
function formatCodexDisplayName(modelId: string): string {
  return modelId
    .split("-")
    .map((part) => {
      if (part.toLowerCase() === "gpt") {
        return "GPT";
      }
      // Capitalize first letter of each word
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

// "Opus 4.5 · Most capable..." -> "Opus 4.5"
function parseClaudeDisplayName(description: string): string {
  const match = description.match(/^([^·]+)/);
  return match ? match[1].trim() : description;
}

// Parse ReasoningEffort::XHigh -> "xhigh"
function parseCodexReasoningEffort(rustEnum: string): CodexReasoningEffort {
  const match = rustEnum.match(/ReasoningEffort::(\w+)/);
  if (!match) {
    throw new Error(`Failed to parse reasoning effort: ${rustEnum}`);
  }
  return match[1].toLowerCase() as CodexReasoningEffort;
}

async function fetchCodexModels(): Promise<ModelInfo[]> {
  console.log("Fetching Codex models from GitHub...");
  const response = await fetch(CODEX_PRESETS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch model_presets.rs: ${response.status}`);
  }
  const content = await response.text();

  // Split content into ModelPreset blocks
  const presetRegex =
    /ModelPreset\s*\{([^}]+supported_reasoning_efforts:\s*&\[[^\]]+\][^}]*)\}/gs;
  const models: ModelInfo[] = [];
  const seen = new Set<string>();

  for (const presetMatch of content.matchAll(presetRegex)) {
    const block = presetMatch[1];

    // Extract model ID
    const idMatch = block.match(/id:\s*"([^"]+)"/);
    if (!idMatch) {
      continue;
    }
    const value = idMatch[1];

    // Skip duplicates (from upgrade references)
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);

    // Extract reasoning efforts from supported_reasoning_efforts array
    const effortsMatch = block.match(
      /supported_reasoning_efforts:\s*&\[([^\]]+)\]/s
    );
    const supportedLevels = new Set<ReasoningLevel>();

    if (effortsMatch) {
      const effortsBlock = effortsMatch[1];
      const effortRegex = /effort:\s*(ReasoningEffort::\w+)/g;
      for (const effortMatch of effortsBlock.matchAll(effortRegex)) {
        const codexEffort = parseCodexReasoningEffort(effortMatch[1]);
        supportedLevels.add(CODEX_TO_LEVEL[codexEffort]);
      }
    }

    // Convert to sorted array
    const supportedReasoningLevels = [...supportedLevels].sort((a, b) => a - b);

    models.push({
      value,
      displayName: formatCodexDisplayName(value),
      supportedReasoningLevels,
    });
  }

  return models.sort((a, b) => a.value.localeCompare(b.value));
}

async function fetchClaudeModels(): Promise<ModelInfo[]> {
  console.log("Fetching Claude models from SDK...");

  const q = query({
    prompt: "",
    options: {
      maxTurns: 0,
    },
  });

  const models = await q.supportedModels();

  // Claude models support all reasoning levels (0-4)
  // (mapped to thinking token budgets at runtime)
  return models
    .map((m) => ({
      value: m.value,
      displayName: parseClaudeDisplayName(m.description),
      supportedReasoningLevels: [0, 1, 2, 3, 4] as ReasoningLevel[],
    }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

function generateModelsFile(
  codexModels: ModelInfo[],
  claudeModels: ModelInfo[]
): string {
  const defaultCodex =
    codexModels.find((m) => m.value === "gpt-5.1-codex-max")?.value ??
    codexModels[0]?.value ??
    "";
  // The SDK returns "default" as a model value - that's literally the default
  const defaultClaude =
    claudeModels.find((m) => m.value === "default")?.value ??
    claudeModels[0]?.value ??
    "";

  const formatModel = (m: ModelInfo) => {
    const levels = m.supportedReasoningLevels.join(", ");
    return `  {
    value: "${m.value}",
    displayName: "${m.displayName}",
    supportedReasoningLevels: [${levels}],
  },`;
  };

  return `// Auto-generated by scripts/populate-models.ts
// Do not edit manually - run: bun run populate-models

/**
 * Reasoning levels as numeric values (0-4) for natural ordering.
 * Higher numbers = more reasoning/thinking tokens.
 */
export const REASONING_LEVELS = [0, 1, 2, 3, 4] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/**
 * Metadata for each reasoning level including provider-specific mappings.
 */
export type ReasoningLevelMeta = {
  level: ReasoningLevel;
  name: string;
  label: string;
  codex: "minimal" | "low" | "medium" | "high" | "xhigh";
  claudeTokens: number;
};

export const REASONING_LEVEL_META: readonly [
  ReasoningLevelMeta,
  ReasoningLevelMeta,
  ReasoningLevelMeta,
  ReasoningLevelMeta,
  ReasoningLevelMeta,
] = [
  { level: 0, name: "none", label: "None", codex: "minimal", claudeTokens: 0 },
  { level: 1, name: "low", label: "Low", codex: "low", claudeTokens: 4000 },
  {
    level: 2,
    name: "medium",
    label: "Medium",
    codex: "medium",
    claudeTokens: 10_000,
  },
  {
    level: 3,
    name: "high",
    label: "High",
    codex: "high",
    claudeTokens: 20_000,
  },
  { level: 4, name: "max", label: "Max", codex: "xhigh", claudeTokens: 32_000 },
] as const;

/**
 * Get metadata for a reasoning level.
 */
export function getReasoningMeta(level: ReasoningLevel): ReasoningLevelMeta {
  return REASONING_LEVEL_META[level];
}

export type ModelInfo = {
  value: string;
  displayName: string;
  supportedReasoningLevels: readonly ReasoningLevel[];
};

export const CODEX_MODELS: readonly ModelInfo[] = [
${codexModels.map(formatModel).join("\n")}
] as const;

export const CLAUDE_MODELS: readonly ModelInfo[] = [
${claudeModels.map(formatModel).join("\n")}
] as const;

export type CodexModel = (typeof CODEX_MODELS)[number]["value"];
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]["value"];

export const DEFAULT_CODEX_MODEL: CodexModel = "${defaultCodex}";
export const DEFAULT_CLAUDE_MODEL: ClaudeModel = "${defaultClaude}";
export const DEFAULT_REASONING_LEVEL: ReasoningLevel = 2;

/**
 * Get model info by model value. Returns undefined if model not found.
 */
export function getModelInfo(
  model: string,
  provider: "claude" | "codex"
): ModelInfo | undefined {
  const models = provider === "claude" ? CLAUDE_MODELS : CODEX_MODELS;
  return models.find((m) => m.value === model);
}

/**
 * Get supported reasoning levels for a model.
 * Returns all levels if model not found (for unknown/custom models).
 */
export function getSupportedReasoningLevels(
  model: string,
  provider: "claude" | "codex"
): readonly ReasoningLevel[] {
  const info = getModelInfo(model, provider);
  return info?.supportedReasoningLevels ?? REASONING_LEVELS;
}

/**
 * Check if a reasoning level is supported for a model.
 */
export function isReasoningLevelSupported(
  model: string,
  provider: "claude" | "codex",
  level: ReasoningLevel
): boolean {
  const supported = getSupportedReasoningLevels(model, provider);
  return supported.includes(level);
}

/**
 * Validate reasoning level for a model. Throws if unsupported.
 */
export function validateReasoningLevel(
  model: string,
  provider: "claude" | "codex",
  level: ReasoningLevel
): void {
  if (!isReasoningLevelSupported(model, provider, level)) {
    const supported = getSupportedReasoningLevels(model, provider);
    const levelMeta = getReasoningMeta(level);
    const supportedNames = supported
      .map((l) => getReasoningMeta(l).name)
      .join(", ");
    throw new Error(
      \`Reasoning level "\${levelMeta.name}" (level \${level}) is not supported for model "\${model}". Supported levels: \${supportedNames}\`
    );
  }
}
`;
}

async function main(): Promise<void> {
  console.log("Populating models...\n");

  const [codexModels, claudeModels] = await Promise.all([
    fetchCodexModels(),
    fetchClaudeModels(),
  ]);

  console.log(
    `  Codex: ${codexModels.length} models: ${codexModels.map((m) => m.value).join(", ")}\n`
  );
  console.log(
    `  Claude: ${claudeModels.length} models: ${claudeModels.map((m) => m.value).join(", ")}\n`
  );

  const output = generateModelsFile(codexModels, claudeModels);
  writeFileSync(OUTPUT_FILE, output);
  console.log(`Written to ${OUTPUT_FILE}`);
}

main().catch(console.error);
