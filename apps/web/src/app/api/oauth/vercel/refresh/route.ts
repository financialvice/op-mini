/**
 * Vercel OAuth Token Refresh - Sign in with Vercel
 *
 * NOTE: This OAuth flow only provides identity scopes (openid, email, profile).
 * Permissions for issuing API requests and interacting with team resources are
 * currently in private beta.
 *
 * @see https://vercel.com/docs/sign-in-with-vercel/scopes-and-permissions#permissions
 */
import { NextResponse } from "next/server";

const VERCEL_CLIENT_ID = process.env.VERCEL_CLIENT_ID!;
const VERCEL_CLIENT_SECRET = process.env.VERCEL_CLIENT_SECRET!;

interface RefreshRequest {
  refresh_token: string;
}

interface VercelTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RefreshRequest;

    if (!body.refresh_token) {
      return NextResponse.json(
        { error: "refresh_token is required" },
        { status: 400 }
      );
    }

    const response = await fetch("https://api.vercel.com/login/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: VERCEL_CLIENT_ID,
        client_secret: VERCEL_CLIENT_SECRET,
        refresh_token: body.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Vercel token refresh failed:", errorText);
      return NextResponse.json(
        { error: "Token refresh failed" },
        { status: response.status }
      );
    }

    const tokenData = (await response.json()) as VercelTokenResponse;
    return NextResponse.json(tokenData);
  } catch (error) {
    console.error("Vercel refresh error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
