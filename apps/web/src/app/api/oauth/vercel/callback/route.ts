/**
 * Vercel OAuth Callback - Sign in with Vercel
 *
 * NOTE: This OAuth flow only provides identity scopes (openid, email, profile).
 * Permissions for issuing API requests and interacting with team resources are
 * currently in private beta.
 *
 * @see https://vercel.com/docs/sign-in-with-vercel/scopes-and-permissions#permissions
 */
import { id as newId } from "@instantdb/admin";
import { adminDb } from "@repo/db/admin";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const VERCEL_CLIENT_ID = process.env.VERCEL_CLIENT_ID!;
const VERCEL_CLIENT_SECRET = process.env.VERCEL_CLIENT_SECRET!;

interface VercelTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    redirect(`/oauth?error=${encodeURIComponent(error)}`);
  }

  if (!(code && state)) {
    redirect("/oauth?error=missing_params");
  }

  // Get stored state from cookie
  const cookieStore = await cookies();
  const storedData = cookieStore.get("vercel_oauth_state")?.value;

  if (!storedData) {
    redirect("/oauth?error=missing_state");
  }

  let parsedData: { state: string; userId: string; codeVerifier: string };
  try {
    parsedData = JSON.parse(storedData);
  } catch {
    redirect("/oauth?error=invalid_state_format");
  }

  if (parsedData.state !== state) {
    redirect("/oauth?error=state_mismatch");
  }

  // Clear the state cookie
  cookieStore.delete("vercel_oauth_state");

  // Exchange code for token with PKCE code_verifier
  const tokenResponse = await fetch(
    "https://api.vercel.com/login/oauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: VERCEL_CLIENT_ID,
        client_secret: VERCEL_CLIENT_SECRET,
        code,
        code_verifier: parsedData.codeVerifier,
        redirect_uri: `${process.env.NEXT_PUBLIC_URL}/api/oauth/vercel/callback`,
      }),
    }
  );

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("Vercel token exchange failed:", errorText);
    redirect("/oauth?error=token_exchange_failed");
  }

  const tokenData = (await tokenResponse.json()) as VercelTokenResponse;

  if (!tokenData.access_token) {
    redirect("/oauth?error=no_access_token");
  }

  // Delete existing Vercel token for this user
  const { db } = adminDb;
  const existing = await db.query({
    oauthTokens: {
      $: {
        where: {
          "user.id": parsedData.userId,
          provider: "vercel",
        },
      },
    },
  });

  const deleteOps = (existing.oauthTokens ?? []).map((t) =>
    db.tx.oauthTokens[t.id]!.delete()
  );

  // Create new token
  const tokenId = newId();
  const now = new Date();
  const expiresAt = tokenData.expires_in
    ? new Date(now.getTime() + tokenData.expires_in * 1000)
    : undefined;

  await db.transact([
    ...deleteOps,
    db.tx.oauthTokens[tokenId]!.create({
      provider: "vercel",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      createdAt: now,
    }).link({
      user: parsedData.userId,
    }),
  ]);

  redirect("/oauth?success=vercel");
}
