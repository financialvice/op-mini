/**
 * Vercel OAuth - Sign in with Vercel
 *
 * NOTE: This OAuth flow only provides identity scopes (openid, email, profile).
 * Permissions for issuing API requests and interacting with team resources are
 * currently in private beta.
 *
 * @see https://vercel.com/docs/sign-in-with-vercel/scopes-and-permissions#permissions
 */
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const VERCEL_CLIENT_ID = process.env.VERCEL_CLIENT_ID!;

function generateSecureRandomString(length: number) {
  const charset =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const randomBytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(randomBytes, (byte) => charset[byte % charset.length]).join(
    ""
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return new Response("Missing userId", { status: 400 });
  }

  // Generate PKCE values
  const state = generateSecureRandomString(43);
  const codeVerifier = crypto.randomBytes(43).toString("hex");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // Store state and code_verifier in cookies
  const cookieStore = await cookies();

  cookieStore.set(
    "vercel_oauth_state",
    JSON.stringify({ state, userId, codeVerifier }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    }
  );

  const params = new URLSearchParams({
    client_id: VERCEL_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${process.env.NEXT_PUBLIC_URL}/api/oauth/vercel/callback`,
    scope: "offline_access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  redirect(`https://vercel.com/oauth/authorize?${params}`);
}
