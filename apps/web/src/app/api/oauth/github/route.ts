import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return new Response("Missing userId", { status: 400 });
  }

  // Generate state with user ID for CSRF protection and user identification
  const state = Buffer.from(
    JSON.stringify({ userId, nonce: crypto.randomUUID() })
  ).toString("base64url");

  // Store state in cookie for verification
  const cookieStore = await cookies();
  cookieStore.set("github_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${process.env.NEXT_PUBLIC_URL}/api/oauth/github/callback`,
    scope: "repo read:org",
    state,
  });

  redirect(`https://github.com/login/oauth/authorize?${params}`);
}
