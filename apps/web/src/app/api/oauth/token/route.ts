import { NextResponse } from "next/server";

const OAUTH_CONFIG = {
  tokenUrl: "https://console.anthropic.com/v1/oauth/token",
  betaHeader: "oauth-2025-04-20",
};

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;

  const response = await fetch(OAUTH_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-beta": OAUTH_CONFIG.betaHeader,
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    return NextResponse.json(data, { status: response.status });
  }

  return NextResponse.json(data);
}
