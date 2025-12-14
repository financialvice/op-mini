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
import { Input } from "@repo/ui/components/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import {
  CheckCircle,
  ExternalLink,
  Github,
  Key,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useState } from "react";
import { CodexDeviceAuthCard } from "./codex-device-auth";
import { VercelImportCard } from "./vercel-import";

const CLAUDE_PROVIDER = "claude";
const GITHUB_PROVIDER = "github";

// Claude Max OAuth config (Anthropic's official client)
const OAUTH_CONFIG = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizationUrl: "https://claude.ai/oauth/authorize",
  redirectUri: "https://console.anthropic.com/oauth/code/callback",
  scope: "user:inference user:profile user:sessions:claude_code",
};

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface PKCEState {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  authUrl: string;
}

interface StoredToken {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// Generate PKCE challenge using Web Crypto API
async function generatePKCE(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return { codeVerifier, codeChallenge };
}

function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Exchange code for token via API route (avoids CORS)
async function exchangeCodeForToken(
  authCode: string,
  pkceState: PKCEState
): Promise<OAuthTokenResponse> {
  const [code, pastedState] = authCode.split("#");

  if (!(code && pastedState)) {
    throw new Error("Invalid code format. Expected: code#state");
  }

  if (pastedState !== pkceState.state) {
    throw new Error("State mismatch - possible CSRF attack");
  }

  const response = await fetch("/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      state: pastedState,
      code_verifier: pkceState.codeVerifier,
      redirect_uri: OAUTH_CONFIG.redirectUri,
      client_id: OAUTH_CONFIG.clientId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  return (await response.json()) as OAuthTokenResponse;
}

// Refresh token via API route
async function refreshAccessToken(
  refreshToken: string
): Promise<OAuthTokenResponse> {
  const response = await fetch("/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OAUTH_CONFIG.clientId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  return (await response.json()) as OAuthTokenResponse;
}

function formatTimeRemaining(expiresAt: Date): string {
  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();

  if (diffMs <= 0) {
    return "Expired";
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Extracted component for token status display
function TokenStatusCard({
  token,
  isExpired,
  isRefreshing,
  testResult,
  onRefresh,
  onTest,
  onDelete,
}: {
  token: StoredToken;
  isExpired: boolean;
  isRefreshing: boolean;
  testResult: string | null;
  onRefresh: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className={isExpired ? "border-destructive" : "border-green-500"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isExpired ? (
            <>
              <XCircle className="size-5 text-destructive" />
              Token Expired
            </>
          ) : (
            <>
              <CheckCircle className="size-5 text-green-500" />
              Token Active
            </>
          )}
        </CardTitle>
        <CardDescription>
          {isExpired
            ? "Your token has expired. Refresh it to continue using Claude."
            : `Expires in ${formatTimeRemaining(new Date(token.expiresAt))}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <span className="font-medium text-sm">Access Token</span>
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 font-mono text-xs">
            {token.accessToken.slice(0, 50)}...
          </pre>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isRefreshing}
            onClick={onRefresh}
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
          <Button onClick={onTest} type="button" variant="secondary">
            Test Token
          </Button>
          <Button onClick={onDelete} type="button" variant="destructive">
            <Trash2 className="mr-2 size-4" />
            Delete
          </Button>
        </div>
        {testResult && (
          <pre className="whitespace-pre-wrap rounded bg-muted p-3 font-mono text-sm">
            {testResult}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

// Extracted component for auth flow
function AuthFlowCard({
  pkceState,
  authCode,
  isExchanging,
  onStartAuth,
  onAuthCodeChange,
  onExchangeCode,
}: {
  pkceState: PKCEState | null;
  authCode: string;
  isExchanging: boolean;
  onStartAuth: () => void;
  onAuthCodeChange: (code: string) => void;
  onExchangeCode: () => void;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>1. Authorize</CardTitle>
          <CardDescription>
            Click to open Claude authorization page. You'll get a code to paste
            below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onStartAuth} type="button">
            <ExternalLink className="mr-2 size-4" />
            Open Claude Authorization
          </Button>
          {pkceState && (
            <p className="mt-2 text-muted-foreground text-sm">
              Auth URL generated. Authorize and copy the code.
            </p>
          )}
        </CardContent>
      </Card>

      {pkceState && (
        <Card>
          <CardHeader>
            <CardTitle>2. Paste Code</CardTitle>
            <CardDescription>
              After authorizing, paste the code (format: code#state)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              onChange={(e) => onAuthCodeChange(e.target.value)}
              placeholder="Paste code#state here..."
              value={authCode}
            />
            <Button
              disabled={!authCode || isExchanging}
              onClick={onExchangeCode}
              type="button"
            >
              {isExchanging ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Exchanging...
                </>
              ) : (
                <>
                  <Key className="mr-2 size-4" />
                  Exchange for Token
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function ClaudeOAuthSection() {
  const { id: userId } = db.useUser();
  const {
    token: storedToken,
    isExpired,
    isLoading,
  } = db.useOAuthToken(CLAUDE_PROVIDER);

  const [pkceState, setPkceState] = useState<PKCEState | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isExchanging, setIsExchanging] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleStartAuth = useCallback(async () => {
    setError(null);
    setTestResult(null);

    const { codeVerifier, codeChallenge } = await generatePKCE();
    const state = generateState();

    const authUrl = new URL(OAUTH_CONFIG.authorizationUrl);
    authUrl.searchParams.set("code", "true");
    authUrl.searchParams.set("client_id", OAUTH_CONFIG.clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", OAUTH_CONFIG.scope);
    authUrl.searchParams.set("redirect_uri", OAUTH_CONFIG.redirectUri);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);

    setPkceState({
      codeVerifier,
      codeChallenge,
      state,
      authUrl: authUrl.toString(),
    });

    window.open(authUrl.toString(), "_blank");
  }, []);

  const handleExchangeCode = useCallback(async () => {
    if (!(pkceState && authCode && userId)) {
      return;
    }

    setError(null);
    setIsExchanging(true);

    try {
      const tokenData = await exchangeCodeForToken(authCode, pkceState);

      if (storedToken?.id) {
        await db.deleteOAuthToken(storedToken.id);
      }

      await db.saveOAuthToken(userId, {
        provider: CLAUDE_PROVIDER,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? "",
        expiresIn: tokenData.expires_in ?? 28_800,
      });

      setPkceState(null);
      setAuthCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsExchanging(false);
    }
  }, [pkceState, authCode, userId, storedToken?.id]);

  const handleRefreshToken = useCallback(async () => {
    if (!(storedToken?.refreshToken && storedToken.id)) {
      return;
    }

    setError(null);
    setIsRefreshing(true);

    try {
      const tokenData = await refreshAccessToken(storedToken.refreshToken);

      await db.updateOAuthToken(storedToken.id, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? storedToken.refreshToken,
        expiresIn: tokenData.expires_in ?? 28_800,
      });
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
    setTestResult(null);
  }, [storedToken?.id]);

  const handleTestToken = useCallback(async () => {
    if (!storedToken?.accessToken) {
      return;
    }

    setTestResult(null);

    try {
      const response = await fetch("/api/oauth/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: storedToken.accessToken }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        setTestResult(`Error: ${errorText}`);
        return;
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      const text = data.content.find((c) => c.type === "text")?.text;
      setTestResult(text ?? "No text in response");
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : "Request failed");
    }
  }, [storedToken?.accessToken]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {storedToken && (
        <TokenStatusCard
          isExpired={isExpired}
          isRefreshing={isRefreshing}
          onDelete={handleDeleteToken}
          onRefresh={handleRefreshToken}
          onTest={handleTestToken}
          testResult={testResult}
          token={storedToken as StoredToken}
        />
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {!storedToken && (
        <AuthFlowCard
          authCode={authCode}
          isExchanging={isExchanging}
          onAuthCodeChange={setAuthCode}
          onExchangeCode={handleExchangeCode}
          onStartAuth={handleStartAuth}
          pkceState={pkceState}
        />
      )}

      {storedToken && (
        <Card>
          <CardHeader>
            <CardTitle>Re-authenticate</CardTitle>
            <CardDescription>
              Get a new token by going through the OAuth flow again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AuthFlowCard
              authCode={authCode}
              isExchanging={isExchanging}
              onAuthCodeChange={setAuthCode}
              onExchangeCode={handleExchangeCode}
              onStartAuth={handleStartAuth}
              pkceState={pkceState}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GitHubOAuthSection() {
  const { id: userId } = db.useUser();
  const { token: storedToken, isLoading } = db.useOAuthToken(GITHUB_PROVIDER);

  const handleConnect = useCallback(() => {
    if (!userId) {
      return;
    }
    window.location.href = `/api/oauth/github?userId=${userId}`;
  }, [userId]);

  const handleDisconnect = useCallback(async () => {
    if (!storedToken?.id) {
      return;
    }
    await db.deleteOAuthToken(storedToken.id);
  }, [storedToken?.id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (storedToken) {
    return (
      <Card className="border-green-500">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="size-5 text-green-500" />
            GitHub Connected
          </CardTitle>
          <CardDescription>
            Your GitHub account is connected. The gh CLI will work in terminal
            sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <span className="font-medium text-sm">Access Token</span>
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 font-mono text-xs">
              {storedToken.accessToken.slice(0, 20)}...
            </pre>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleConnect} type="button" variant="outline">
              <RefreshCw className="mr-2 size-4" />
              Reconnect
            </Button>
            <Button
              onClick={handleDisconnect}
              type="button"
              variant="destructive"
            >
              <Trash2 className="mr-2 size-4" />
              Disconnect
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="size-5" />
          Connect GitHub
        </CardTitle>
        <CardDescription>
          Connect your GitHub account to use the gh CLI in terminal sessions and
          enable AI agents to interact with your repositories.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleConnect} type="button">
          <Github className="mr-2 size-4" />
          Connect GitHub
        </Button>
      </CardContent>
    </Card>
  );
}

export default function OAuthPlaygroundPage() {
  return (
    <div className="container mx-auto max-w-2xl space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="font-bold text-3xl">OAuth Tokens</h1>
        <p className="text-muted-foreground">
          Authenticate with your subscriptions to use Claude Max or ChatGPT Plus
          for AI agents.
        </p>
      </div>

      <Tabs className="w-full" defaultValue="claude">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="claude">Claude</TabsTrigger>
          <TabsTrigger value="codex">Codex</TabsTrigger>
          <TabsTrigger value="github">GitHub</TabsTrigger>
          <TabsTrigger value="vercel">Vercel</TabsTrigger>
        </TabsList>
        <TabsContent className="mt-4" value="claude">
          <ClaudeOAuthSection />
        </TabsContent>
        <TabsContent className="mt-4" value="codex">
          <CodexDeviceAuthCard />
        </TabsContent>
        <TabsContent className="mt-4" value="github">
          <GitHubOAuthSection />
        </TabsContent>
        <TabsContent className="mt-4" value="vercel">
          <VercelImportCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
