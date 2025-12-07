import { NextResponse } from "next/server";

const OPENAI_AUTH_CONFIG = {
  tokenUrl: "https://auth.openai.com/oauth/token",
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
};

interface RefreshRequest {
  refresh_token: string;
  client_id?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as RefreshRequest;

  if (!body.refresh_token) {
    return NextResponse.json(
      { error: "refresh_token is required" },
      { status: 400 }
    );
  }

  // OpenAI uses form-urlencoded, not JSON
  const formData = new URLSearchParams({
    client_id: body.client_id ?? OPENAI_AUTH_CONFIG.clientId,
    grant_type: "refresh_token",
    refresh_token: body.refresh_token,
    scope: "openid profile email",
  });

  const response = await fetch(OPENAI_AUTH_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  const data = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    return NextResponse.json(data, { status: response.status });
  }

  return NextResponse.json(data);
}
