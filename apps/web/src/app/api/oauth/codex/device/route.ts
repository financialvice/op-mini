import { NextResponse } from "next/server";

const OPENAI_AUTH_BASE = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

interface UserCodeResponse {
  device_auth_id: string;
  user_code: string;
  interval: number | string;
}

/**
 * POST /api/oauth/codex/device
 *
 * Initiates the device authorization flow by requesting a user code from OpenAI.
 * Returns the device_auth_id, user_code, and polling interval.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const response = await fetch(
      `${OPENAI_AUTH_BASE}/api/accounts/deviceauth/usercode`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: CLIENT_ID }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Failed to get device code: ${errorText}` },
        { status: response.status }
      );
    }

    const data = (await response.json()) as UserCodeResponse;

    return NextResponse.json({
      device_auth_id: data.device_auth_id,
      user_code: data.user_code,
      interval: Number(data.interval) || 5,
      verification_url: `${OPENAI_AUTH_BASE}/codex/device`,
      expires_in: 15 * 60, // 15 minutes
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
