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
  CheckCircle,
  ExternalLink,
  Key,
  Loader2,
  Trash2,
  Triangle,
} from "lucide-react";
import { useCallback, useState } from "react";

const VERCEL_PROVIDER = "vercel";

interface StoredToken {
  id: string;
  accessToken: string;
}

async function validateVercelToken(token: string): Promise<void> {
  const response = await fetch("https://api.vercel.com/v2/user", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      errorData.error?.message ?? `Token validation failed (${response.status})`
    );
  }
}

export function VercelImportCard() {
  const { id: userId } = db.useUser();
  const { token: storedToken, isLoading } = db.useOAuthToken(VERCEL_PROVIDER);

  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = useCallback(async () => {
    const token = tokenInput.trim();
    if (!(token && userId)) {
      return;
    }

    // Basic validation - Vercel tokens start with specific prefixes
    if (!token.match(/^[a-zA-Z0-9_-]+$/)) {
      setError("Invalid token format. Please paste the full token.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsImporting(true);

    try {
      // Test the token first
      await validateVercelToken(token);

      // Delete existing token if present
      if (storedToken?.id) {
        await db.deleteOAuthToken(storedToken.id);
      }

      // Vercel API tokens can last up to 1 year, we'll set a long expiry
      // Users should set an appropriate expiry when creating the token
      const expiresIn = 365 * 24 * 60 * 60; // 1 year in seconds

      await db.saveOAuthToken(userId, {
        provider: VERCEL_PROVIDER,
        accessToken: token,
        refreshToken: "", // API tokens don't have refresh tokens
        expiresIn,
      });

      setTokenInput("");
      setSuccess(
        "Vercel token saved! The vercel CLI will now work in terminal sessions."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setIsImporting(false);
    }
  }, [tokenInput, userId, storedToken?.id]);

  const handleDeleteToken = useCallback(async () => {
    if (!storedToken?.id) {
      return;
    }

    await db.deleteOAuthToken(storedToken.id);
    setSuccess(null);
    setError(null);
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
        <Card className="border-green-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="size-5 text-green-500" />
              Vercel Token Active
            </CardTitle>
            <CardDescription>
              Your Vercel API token is configured. The vercel CLI will work in
              terminal sessions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <span className="font-medium text-sm">Access Token</span>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 font-mono text-xs">
                {(storedToken as StoredToken).accessToken.slice(0, 20)}...
              </pre>
            </div>
            <Button
              onClick={handleDeleteToken}
              type="button"
              variant="destructive"
            >
              <Trash2 className="mr-2 size-4" />
              Delete Token
            </Button>
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
            <Triangle className="size-5" />
            Add Vercel API Token
          </CardTitle>
          <CardDescription>
            Create an API token from your Vercel account settings to enable CLI
            access in terminal sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step 1: Create token */}
          <div className="space-y-2">
            <span className="font-medium text-sm">1. Create an API Token</span>
            <p className="text-muted-foreground text-sm">
              Go to your Vercel account settings and create a new token. Set the
              scope to your account or team, and choose an expiration (we
              recommend 1 year).
            </p>
            <Button asChild type="button" variant="outline">
              <a
                href="https://vercel.com/account/tokens"
                rel="noopener noreferrer"
                target="_blank"
              >
                <ExternalLink className="mr-2 size-4" />
                Open Vercel Token Settings
              </a>
            </Button>
          </div>

          {/* Step 2: Paste token */}
          <div className="space-y-2">
            <span className="font-medium text-sm">2. Paste your token</span>
            <Input
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Paste your Vercel API token here..."
              type="password"
              value={tokenInput}
            />
          </div>

          <Button
            className="w-full"
            disabled={!tokenInput.trim() || isImporting}
            onClick={handleImport}
            type="button"
          >
            {isImporting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Validating...
              </>
            ) : (
              <>
                <Key className="mr-2 size-4" />
                Save Token
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
