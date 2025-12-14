import { type NextRequest, NextResponse } from "next/server";

const OPENAI_AUTH_BASE = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_AUTH_CALLBACK = `${OPENAI_AUTH_BASE}/deviceauth/callback`;

interface PollRequest {
  device_auth_id: string;
  user_code: string;
}

interface DeviceAuthSuccess {
  authorization_code: string;
  code_challenge: string;
  code_verifier: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * POST /api/oauth/codex/device/poll
 *
 * Polls the OpenAI device auth endpoint to check if user has completed authorization.
 * When successful, exchanges the authorization code for tokens.
 *
 * Returns:
 * - { status: "pending" } if still waiting
 * - { status: "complete", tokens: {...} } on success
 * - { error: "..." } on failure
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as PollRequest;
    const { device_auth_id, user_code } = body;

    if (!(device_auth_id && user_code)) {
      return NextResponse.json(
        { error: "Missing device_auth_id or user_code" },
        { status: 400 }
      );
    }

    // Poll the device auth token endpoint
    const pollResponse = await fetch(
      `${OPENAI_AUTH_BASE}/api/accounts/deviceauth/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_auth_id, user_code }),
      }
    );

    // 403/404 means still pending
    if (
      pollResponse.status === 403 ||
      pollResponse.status === 404 ||
      pollResponse.status === 428
    ) {
      return NextResponse.json({ status: "pending" });
    }

    if (!pollResponse.ok) {
      const errorText = await pollResponse.text();
      return NextResponse.json(
        { error: `Device auth failed: ${errorText}` },
        { status: pollResponse.status }
      );
    }

    // Success - we got the authorization code
    const authData = (await pollResponse.json()) as DeviceAuthSuccess;

    // Exchange the authorization code for tokens
    const tokenResponse = await fetch(`${OPENAI_AUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authData.authorization_code,
        redirect_uri: DEVICE_AUTH_CALLBACK,
        client_id: CLIENT_ID,
        code_verifier: authData.code_verifier,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return NextResponse.json(
        { error: `Token exchange failed: ${errorText}` },
        { status: tokenResponse.status }
      );
    }

    const tokens = (await tokenResponse.json()) as TokenResponse;

    return NextResponse.json({
      status: "complete",
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
        expires_in: tokens.expires_in,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
