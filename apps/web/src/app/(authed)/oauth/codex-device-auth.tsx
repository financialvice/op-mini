"use client";

import { db } from "@repo/db";
import { trpc } from "@repo/trpc/client";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Smartphone,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const CODEX_PROVIDER = "codex";

interface DeviceCodeData {
  device_auth_id: string;
  user_code: string;
  verification_url: string;
  interval: number;
  expires_in: number;
}

interface PollResponse {
  status: "pending" | "complete";
  tokens?: {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };
  error?: string;
}

interface StoredToken {
  id: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

type AuthState = "idle" | "loading" | "awaiting_user" | "success" | "error";

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

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Extracted component for token status display
function TokenStatusCard({
  token,
  isExpired,
  isRefreshing,
  isTesting,
  testResult,
  error,
  onRefresh,
  onTest,
  onDelete,
  onReauth,
}: {
  token: StoredToken;
  isExpired: boolean;
  isRefreshing: boolean;
  isTesting: boolean;
  testResult: string | null;
  error: string | null;
  onRefresh: () => void;
  onTest: () => void;
  onDelete: () => void;
  onReauth: () => void;
}) {
  return (
    <div className="space-y-4">
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
              ? "Your Codex token has expired. Refresh it or sign in again."
              : `Expires in ${formatTimeRemaining(new Date(token.expiresAt ?? new Date()))}`}
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
              disabled={isRefreshing || !token.refreshToken}
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
            <Button
              disabled={isTesting}
              onClick={onTest}
              type="button"
              variant="secondary"
            >
              {isTesting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
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
          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-5" />
            Re-authenticate
          </CardTitle>
          <CardDescription>Sign in again to get a fresh token.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onReauth} type="button" variant="outline">
            Start Device Authorization
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Extracted component for device code display
function DeviceCodeDisplay({
  deviceCode,
  timeRemaining,
  onCopyCode,
  codeCopied,
  onCancel,
}: {
  deviceCode: DeviceCodeData;
  timeRemaining: number;
  onCopyCode: () => void;
  codeCopied: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/50 p-4 text-center">
        <p className="mb-2 text-muted-foreground text-sm">
          Enter this code at OpenAI
        </p>
        <div className="flex items-center justify-center gap-2">
          <code className="rounded bg-primary/10 px-4 py-2 font-bold font-mono text-2xl text-primary tracking-widest">
            {deviceCode.user_code}
          </code>
          <Button
            onClick={onCopyCode}
            size="icon"
            type="button"
            variant="ghost"
          >
            {codeCopied ? (
              <CheckCircle className="size-4 text-green-500" />
            ) : (
              <ClipboardCopy className="size-4" />
            )}
          </Button>
        </div>
        <p className="mt-2 text-muted-foreground text-xs">
          Expires in {formatCountdown(timeRemaining)}
        </p>
      </div>

      <Button asChild className="w-full" variant="outline">
        <a
          href={deviceCode.verification_url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink className="mr-2 size-4" />
          Open OpenAI Sign-in Page
        </a>
      </Button>

      <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" />
        Waiting for authorization...
      </div>

      <Button
        className="w-full"
        onClick={onCancel}
        type="button"
        variant="ghost"
      >
        Cancel
      </Button>
    </div>
  );
}

export function CodexDeviceAuthCard() {
  const { id: userId } = db.useUser();
  const {
    token: storedToken,
    isExpired,
    isLoading: isTokenLoading,
  } = db.useOAuthToken(CODEX_PROVIDER);

  const [authState, setAuthState] = useState<AuthState>("idle");
  const [deviceCode, setDeviceCode] = useState<DeviceCodeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [testResult, setTestResult] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const expiryIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const codexDeviceInitMutation = useMutation(
    trpc.oauth.codexDeviceInit.mutationOptions()
  );
  const codexDevicePollMutation = useMutation(
    trpc.oauth.codexDevicePoll.mutationOptions()
  );
  const codexRefreshMutation = useMutation(
    trpc.oauth.codexRefresh.mutationOptions()
  );
  const codexTestMutation = useMutation(trpc.oauth.codexTest.mutationOptions());

  const cleanup = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (expiryIntervalRef.current) {
      clearInterval(expiryIntervalRef.current);
      expiryIntervalRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handleCopyCode = useCallback(async () => {
    if (!deviceCode?.user_code) {
      return;
    }
    await navigator.clipboard.writeText(deviceCode.user_code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }, [deviceCode?.user_code]);

  const handlePollSuccess = useCallback(
    async (tokens: NonNullable<PollResponse["tokens"]>) => {
      cleanup();

      if (storedToken?.id) {
        await db.deleteOAuthToken(storedToken.id);
      }

      if (userId) {
        await db.saveOAuthToken(userId, {
          provider: CODEX_PROVIDER,
          accessToken: tokens.access_token,
          idToken: tokens.id_token,
          refreshToken: tokens.refresh_token ?? "",
          expiresIn: tokens.expires_in ?? 8 * 24 * 60 * 60,
        });
      }

      setAuthState("success");
    },
    [cleanup, storedToken?.id, userId]
  );

  const startDeviceFlow = useCallback(async () => {
    if (!userId) {
      return;
    }

    setAuthState("loading");
    setError(null);
    setTestResult(null);
    cleanup();

    try {
      const result = await codexDeviceInitMutation.mutateAsync(undefined);

      if ("error" in result && result.error) {
        throw new Error(result.error);
      }

      const data = result.data as DeviceCodeData;
      setDeviceCode(data);
      setTimeRemaining(data.expires_in);
      setAuthState("awaiting_user");

      expiryIntervalRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            cleanup();
            setAuthState("error");
            setError("Device code expired. Please try again.");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      const pollInterval = (data.interval || 5) * 1000;
      pollIntervalRef.current = setInterval(async () => {
        try {
          const pollResult = await codexDevicePollMutation.mutateAsync({
            deviceAuthId: data.device_auth_id,
            userCode: data.user_code,
          });

          if ("error" in pollResult && pollResult.error) {
            cleanup();
            setAuthState("error");
            setError(pollResult.error);
            return;
          }

          if (
            pollResult.status === "complete" &&
            "tokens" in pollResult &&
            pollResult.tokens
          ) {
            await handlePollSuccess(pollResult.tokens);
          }
        } catch (pollError) {
          console.error("Poll error:", pollError);
        }
      }, pollInterval);
    } catch (err) {
      setAuthState("error");
      setError(err instanceof Error ? err.message : "Failed to start auth");
    }
  }, [
    userId,
    cleanup,
    handlePollSuccess,
    codexDeviceInitMutation,
    codexDevicePollMutation,
  ]);

  const cancelFlow = useCallback(() => {
    cleanup();
    setAuthState("idle");
    setDeviceCode(null);
    setError(null);
  }, [cleanup]);

  const handleRefreshToken = useCallback(async () => {
    const token = storedToken as StoredToken | null;
    if (!(token?.refreshToken && token.id)) {
      return;
    }

    setError(null);

    try {
      const result = await codexRefreshMutation.mutateAsync({
        refreshToken: token.refreshToken,
      });

      if ("error" in result && result.error) {
        throw new Error("Token refresh failed");
      }

      const tokenData = result.data as {
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
      };

      if (!tokenData.access_token) {
        throw new Error("No access token in refresh response");
      }

      await db.updateOAuthToken(token.id, {
        accessToken: tokenData.access_token,
        idToken: tokenData.id_token,
        refreshToken: tokenData.refresh_token ?? token.refreshToken,
        expiresIn: 8 * 24 * 60 * 60,
      });

      setTestResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    }
  }, [storedToken, codexRefreshMutation]);

  const handleDeleteToken = useCallback(async () => {
    if (!storedToken?.id) {
      return;
    }

    await db.deleteOAuthToken(storedToken.id);
    setTestResult(null);
    setAuthState("idle");
  }, [storedToken?.id]);

  const handleTestToken = useCallback(async () => {
    const token = storedToken as StoredToken | null;
    if (!token?.accessToken) {
      return;
    }

    setTestResult(null);

    try {
      const result = await codexTestMutation.mutateAsync({
        accessToken: token.accessToken,
      });

      if ("error" in result && result.error) {
        const errorData = result.error as OpenAIResponse["error"];
        setTestResult(`Error: ${errorData?.message ?? "Request failed"}`);
        return;
      }

      const data = result.data as OpenAIResponse;
      const text = data.choices?.[0]?.message?.content;
      setTestResult(text ?? "No response content");
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : "Request failed");
    }
  }, [storedToken, codexTestMutation]);

  if (isTokenLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (storedToken && authState === "idle") {
    return (
      <TokenStatusCard
        error={error}
        isExpired={isExpired}
        isRefreshing={codexRefreshMutation.isPending}
        isTesting={codexTestMutation.isPending}
        onDelete={handleDeleteToken}
        onReauth={startDeviceFlow}
        onRefresh={handleRefreshToken}
        onTest={handleTestToken}
        testResult={testResult}
        token={storedToken as StoredToken}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-5" />
          Sign in with Device Code
        </CardTitle>
        <CardDescription>
          Sign in to your OpenAI account using a one-time device code. No need
          to copy auth.json manually.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {authState === "idle" && (
          <Button className="w-full" onClick={startDeviceFlow} type="button">
            Start Device Authorization
          </Button>
        )}

        {authState === "loading" && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Initializing...</span>
          </div>
        )}

        {authState === "awaiting_user" && deviceCode && (
          <DeviceCodeDisplay
            codeCopied={codeCopied}
            deviceCode={deviceCode}
            onCancel={cancelFlow}
            onCopyCode={handleCopyCode}
            timeRemaining={timeRemaining}
          />
        )}

        {authState === "success" && (
          <div className="flex flex-col items-center gap-2 py-4">
            <CheckCircle className="size-12 text-green-500" />
            <p className="font-medium text-green-600">
              Successfully connected to Codex!
            </p>
            <Button
              className="mt-2"
              onClick={() => setAuthState("idle")}
              type="button"
              variant="outline"
            >
              Done
            </Button>
          </div>
        )}

        {authState === "error" && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-4">
              <XCircle className="size-12 text-destructive" />
              <p className="text-center text-destructive text-sm">{error}</p>
            </div>
            <Button
              className="w-full"
              onClick={startDeviceFlow}
              type="button"
              variant="outline"
            >
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
