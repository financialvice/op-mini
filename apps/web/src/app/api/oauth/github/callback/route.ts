import { id as newId } from "@instantdb/admin";
import { adminDb } from "@repo/db/admin";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
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

  // Verify state from cookie
  const cookieStore = await cookies();
  const storedState = cookieStore.get("github_oauth_state")?.value;

  if (!storedState || storedState !== state) {
    redirect("/oauth?error=invalid_state");
  }

  // Clear the state cookie
  cookieStore.delete("github_oauth_state");

  // Parse user ID from state
  let userId: string;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    userId = parsed.userId;
  } catch {
    redirect("/oauth?error=invalid_state_format");
  }

  // Exchange code for token
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    }
  );

  if (!tokenResponse.ok) {
    redirect("/oauth?error=token_exchange_failed");
  }

  const tokenData = (await tokenResponse.json()) as GitHubTokenResponse;

  if (!tokenData.access_token) {
    redirect("/oauth?error=no_access_token");
  }

  // Delete existing GitHub token for this user
  const { db } = adminDb;
  const existing = await db.query({
    oauthTokens: {
      $: {
        where: {
          "user.id": userId,
          provider: "github",
        },
      },
    },
  });

  const deleteOps = (existing.oauthTokens ?? []).map((t) =>
    db.tx.oauthTokens[t.id]!.delete()
  );

  // Create new token (GitHub tokens don't expire by default)
  const tokenId = newId();
  const now = new Date();

  await db.transact([
    ...deleteOps,
    db.tx.oauthTokens[tokenId]!.create({
      provider: "github",
      accessToken: tokenData.access_token,
      createdAt: now,
    }).link({
      user: userId,
    }),
  ]);

  redirect("/oauth?success=github");
}
