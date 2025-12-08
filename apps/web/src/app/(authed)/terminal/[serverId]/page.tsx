"use client";

import { db } from "@repo/db";
import { useTRPC } from "@repo/trpc/client";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { useMemo } from "react";

const TerminalComponent = dynamic(
  () => import("./terminal").then((mod) => mod.TerminalComponent),
  { ssr: false }
);

type FileToWrite = {
  path: string;
  content: string;
  mode?: string;
};

export default function TerminalPage() {
  const params = useParams<{ serverId: string }>();
  const searchParams = useSearchParams();
  const provider = searchParams.get("provider") ?? "hetzner";
  const trpc = useTRPC();

  const { token: claudeToken } = db.useOAuthToken("claude");
  const { token: codexToken } = db.useOAuthToken("codex");

  // Keep morph instances alive by refreshing TTL every 30 seconds
  const instanceId = params.serverId ?? "";
  useQuery({
    ...trpc.morph.instance.refreshTtl.queryOptions({ instanceId }),
    enabled: provider === "morph" && !!instanceId,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const env = useMemo(() => {
    const vars: Record<string, string> = {
      IS_SANDBOX: "true",
    };
    if (claudeToken?.accessToken) {
      vars.CLAUDE_CODE_OAUTH_TOKEN = claudeToken.accessToken;
    }
    return vars;
  }, [claudeToken?.accessToken]);

  // Write config files for headless operation of AI coding assistants
  const files = useMemo<FileToWrite[]>(() => {
    const configFiles: FileToWrite[] = [
      // Claude Code: Skip onboarding prompts and bypass permissions warning
      // See: https://github.com/anthropics/claude-code/issues/8938
      {
        path: "~/.claude.json",
        content: JSON.stringify({
          hasCompletedOnboarding: true,
          bypassPermissionsModeAccepted: true,
        }),
        mode: "600",
      },
      // Claude Code: Enable auto-accept permissions for sandbox environment
      {
        path: "~/.claude/settings.json",
        content: JSON.stringify({
          permissions: { defaultMode: "bypassPermissions" },
        }),
        mode: "600",
      },
      // Codex: Skip directory trust prompt and auto-approve all commands
      // See: https://github.com/openai/codex - codex-rs/tui/src/lib.rs
      // Setting sandbox_mode bypasses the trust directory onboarding screen
      {
        path: "~/.codex/config.toml",
        content: `# Auto-generated config for sandbox environment
sandbox_mode = "danger-full-access"
approval_policy = "never"
`,
        mode: "600",
      },
    ];

    // Codex: Write auth.json if user has Codex token
    // See: https://github.com/openai/codex - codex-rs/core/src/auth.rs
    if (codexToken?.accessToken) {
      configFiles.push({
        path: "~/.codex/auth.json",
        content: JSON.stringify({
          OPENAI_API_KEY: null,
          tokens: {
            id_token: codexToken.accessToken,
            access_token: codexToken.accessToken,
            refresh_token: "managed-externally",
          },
          last_refresh: new Date().toISOString(),
        }),
        mode: "600",
      });
    }

    return configFiles;
  }, [codexToken?.accessToken]);

  if (!params.serverId) {
    return null;
  }

  return (
    <div className="flex h-screen flex-col bg-black p-2">
      <div className="mb-2 font-mono text-gray-400 text-sm">
        {provider}: {params.serverId}
      </div>
      <div className="flex-1">
        <TerminalComponent
          env={env}
          files={files}
          machineId={params.serverId}
          provider={provider}
        />
      </div>
    </div>
  );
}
