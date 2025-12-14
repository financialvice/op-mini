"use client";

import { db } from "@repo/db";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Textarea } from "@repo/ui/components/textarea";
import {
  CheckCircle,
  ClipboardCopy,
  Download,
  Loader2,
  RefreshCw,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useState } from "react";

const CODEX_PROVIDER = "codex";

// OpenAI auth endpoint for token refresh
const OPENAI_AUTH_CONFIG = {
  tokenUrl: "https://auth.openai.com/oauth/token",
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
};

interface CodexAuthJson {
  OPENAI_API_KEY?: string;
  tokens?: {
    id_token: string;
    access_token: string;
    refresh_token: string;
    account_id?: string;
  };
  last_refresh?: string;
}

interface StoredToken {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// Platform-specific commands
const COPY_COMMANDS = {
  mac: "cat ~/.codex/auth.json | pbcopy",
  linux: "cat ~/.codex/auth.json | xclip -selection clipboard",
  windows: "type %USERPROFILE%\\.codex\\auth.json | clip",
};

/**
 * Parse and validate auth.json content.
 * Throws descriptive errors for invalid content.
 */
function parseCodexAuthJson(input: string): {
  accessToken: string;
  idToken: string;
  refreshToken: string;
} {
  const parsed = JSON.parse(input.trim()) as CodexAuthJson;

  if (!parsed.tokens?.access_token) {
    throw new Error(
      "Invalid auth.json: missing tokens.access_token. Make sure you ran 'codex login' first."
    );
  }

  if (!parsed.tokens.id_token) {
    throw new Error(
      "Invalid auth.json: missing tokens.id_token. Try running 'codex login' again."
    );
  }

  if (!parsed.tokens.refresh_token) {
    throw new Error(
      "Invalid auth.json: missing tokens.refresh_token. Try running 'codex login' again."
    );
  }

  return {
    accessToken: parsed.tokens.access_token,
    idToken: parsed.tokens.id_token,
    refreshToken: parsed.tokens.refresh_token,
  };
}

/**
 * Convert error to user-friendly message.
 */
function getImportErrorMessage(err: unknown): string {
  if (err instanceof SyntaxError) {
    return "Invalid JSON format. Please paste the entire auth.json file contents.";
  }
  return err instanceof Error ? err.message : "Import failed";
}

function formatTimeRemaining(expiresAt: Date): string {
  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();

  if (diffMs <= 0) {
    return "Expired";
  }

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h`;
}

// Refresh Codex token via our API proxy
async function refreshCodexToken(refreshToken: string): Promise<{
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
}> {
  const response = await fetch("/api/oauth/codex/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: OPENAI_AUTH_CONFIG.clientId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  return response.json() as Promise<{
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
  }>;
}

export function CodexImportCard() {
  const { id: userId } = db.useUser();
  const {
    token: storedToken,
    isExpired,
    isLoading,
  } = db.useOAuthToken(CODEX_PROVIDER);

  const [authJsonInput, setAuthJsonInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const handleCopyCommand = useCallback(
    async (platform: "mac" | "linux" | "windows") => {
      const command = COPY_COMMANDS[platform];
      await navigator.clipboard.writeText(command);
      setCopiedCommand(platform);
      setTimeout(() => setCopiedCommand(null), 2000);
    },
    []
  );

  const handleImport = useCallback(async () => {
    if (!(authJsonInput.trim() && userId)) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsImporting(true);

    try {
      const { accessToken, idToken, refreshToken } =
        parseCodexAuthJson(authJsonInput);

      // Delete existing token if present
      if (storedToken?.id) {
        await db.deleteOAuthToken(storedToken.id);
      }

      // Codex tokens typically last 8 days based on their refresh interval
      const expiresIn = 8 * 24 * 60 * 60; // 8 days in seconds

      await db.saveOAuthToken(userId, {
        provider: CODEX_PROVIDER,
        accessToken,
        idToken,
        refreshToken,
        expiresIn,
      });

      setAuthJsonInput("");
      setSuccess("Codex credentials imported successfully!");
    } catch (err) {
      setError(getImportErrorMessage(err));
    } finally {
      setIsImporting(false);
    }
  }, [authJsonInput, userId, storedToken?.id]);

  const handleRefreshToken = useCallback(async () => {
    if (!(storedToken?.refreshToken && storedToken.id)) {
      return;
    }

    setError(null);
    setIsRefreshing(true);

    try {
      const tokenData = await refreshCodexToken(storedToken.refreshToken);

      if (!tokenData.access_token) {
        throw new Error("No access token in refresh response");
      }

      await db.updateOAuthToken(storedToken.id, {
        accessToken: tokenData.access_token,
        idToken: tokenData.id_token,
        refreshToken: tokenData.refresh_token ?? storedToken.refreshToken,
        expiresIn: 8 * 24 * 60 * 60, // 8 days
      });

      setSuccess("Token refreshed successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setIsRefreshing(false);
    }
  }, [storedToken]);

  const handleDeleteToken = useCallback(async () => {
    if (!storedToken?.id) {
      return;
    }

    await db.deleteOAuthToken(storedToken.id);
    setSuccess(null);
  }, [storedToken?.id]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Token Status */}
      {storedToken && (
        <Card className={isExpired ? "border-destructive" : "border-green-500"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isExpired ? (
                <>
                  <XCircle className="size-5 text-destructive" />
                  Codex Token Expired
                </>
              ) : (
                <>
                  <CheckCircle className="size-5 text-green-500" />
                  Codex Token Active
                </>
              )}
            </CardTitle>
            <CardDescription>
              {isExpired
                ? "Your Codex token has expired. Refresh it or re-import from auth.json."
                : `Expires in ${formatTimeRemaining(new Date(storedToken.expiresAt ?? new Date()))}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <span className="font-medium text-sm">Access Token</span>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 font-mono text-xs">
                {(storedToken as StoredToken).accessToken.slice(0, 50)}...
              </pre>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isRefreshing}
                onClick={handleRefreshToken}
                type="button"
                variant="outline"
              >
                {isRefreshing ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-4" />
                )}
                Refresh Token
              </Button>
              <Button
                onClick={handleDeleteToken}
                type="button"
                variant="destructive"
              >
                <Trash2 className="mr-2 size-4" />
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error/Success Messages */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {success && (
        <Card className="border-green-500">
          <CardContent className="pt-6">
            <p className="text-green-600 text-sm">{success}</p>
          </CardContent>
        </Card>
      )}

      {/* Import Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-5" />
            Import from Codex CLI
          </CardTitle>
          <CardDescription>
            First run <code className="rounded bg-muted px-1">codex login</code>{" "}
            in your terminal, then copy auth.json to clipboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step 1: Run codex login */}
          <div className="space-y-2">
            <span className="font-medium text-sm">
              1. Login with Codex CLI (if not already)
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted p-3 font-mono text-sm">
                codex login
              </code>
            </div>
          </div>

          {/* Step 2: Copy auth.json */}
          <div className="space-y-2">
            <span className="font-medium text-sm">
              2. Copy auth.json to clipboard
            </span>
            <div className="space-y-2">
              {(["mac", "linux", "windows"] as const).map((platform) => (
                <div
                  className="flex items-center gap-2 rounded bg-muted p-2"
                  key={platform}
                >
                  <span className="w-16 text-muted-foreground text-xs uppercase">
                    {platform}
                  </span>
                  <code className="flex-1 font-mono text-xs">
                    {COPY_COMMANDS[platform]}
                  </code>
                  <Button
                    onClick={() => handleCopyCommand(platform)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {copiedCommand === platform ? (
                      <CheckCircle className="size-4 text-green-500" />
                    ) : (
                      <ClipboardCopy className="size-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Step 3: Paste */}
          <div className="space-y-2">
            <span className="font-medium text-sm">
              3. Paste auth.json contents below
            </span>
            <Textarea
              className="min-h-32 font-mono text-xs"
              onChange={(e) => setAuthJsonInput(e.target.value)}
              placeholder='{"OPENAI_API_KEY": "...", "tokens": {...}, "last_refresh": "..."}'
              value={authJsonInput}
            />
          </div>

          <Button
            className="w-full"
            disabled={!authJsonInput.trim() || isImporting}
            onClick={handleImport}
            type="button"
          >
            {isImporting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Download className="mr-2 size-4" />
                Import Credentials
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
