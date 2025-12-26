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

  const { id: userId } = db.useUser();
  const { token: claudeToken } = db.useOAuthToken("claude");
  const { token: codexToken } = db.useOAuthToken("codex");
  const { token: githubToken } = db.useOAuthToken("github");
  const { token: vercelToken } = db.useOAuthToken("vercel");

  // Keep morph instances alive by refreshing TTL every 30 seconds
  const instanceId = params.serverId ?? "";
  useQuery({
    ...trpc.morph.instance.refreshTtl.queryOptions({ instanceId }),
    enabled: provider === "morph" && !!instanceId,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  // Fetch Fly machine details to get privateIp
  const { data: flyMachine } = useQuery({
    ...trpc.fly.machines.get.queryOptions({ machineId: instanceId }),
    enabled: provider === "fly" && !!instanceId,
  });

  const env = useMemo(() => {
    const vars: Record<string, string> = {
      IS_SANDBOX: "true",
      // Morph API for template commands
      MORPH_API_KEY: "morph_k4bK5nJrMbx5oBGWs6cVGe",
      // InstantDB for operator CLI database access
      NEXT_PUBLIC_INSTANT_APP_ID: "10a35d54-22ab-40d4-99e9-1a2b8d9b90b3",
      INSTANT_APP_ADMIN_TOKEN: "23361bdb-bc19-409a-91fb-c34a3db049d1",
      // Trigger.dev for workflow tasks
      TRIGGER_SECRET_KEY: "tr_dev_1enhpd7g8ZgWvqtQoulG",
    };
    // User ID for operator CLI to fetch OAuth tokens
    if (userId) {
      vars.SWITCHBOARD_USER_ID = userId;
    }
    if (claudeToken?.accessToken) {
      vars.CLAUDE_CODE_OAUTH_TOKEN = claudeToken.accessToken;
    }
    if (githubToken?.accessToken) {
      vars.GH_TOKEN = githubToken.accessToken;
    }
    if (vercelToken?.accessToken) {
      vars.VERCEL_TOKEN = vercelToken.accessToken;
    }
    return vars;
  }, [
    userId,
    claudeToken?.accessToken,
    githubToken?.accessToken,
    vercelToken?.accessToken,
  ]);

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

  // Wait for Fly machine privateIp before rendering terminal
  const isFlyReady = provider !== "fly" || !!flyMachine?.private_ip;

  return (
    <div className="flex h-full flex-col bg-black p-2">
      <div className="mb-2 font-mono text-gray-400 text-sm">
        {provider}: {params.serverId}
      </div>
      <div className="flex-1">
        {isFlyReady ? (
          <TerminalComponent
            env={env}
            files={files}
            machineId={params.serverId}
            privateIp={flyMachine?.private_ip}
            provider={provider}
          />
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-gray-500">
            Loading machine details...
          </div>
        )}
      </div>
    </div>
  );
}
