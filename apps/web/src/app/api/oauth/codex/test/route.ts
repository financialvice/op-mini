import { NextResponse } from "next/server";

/**
 * POST /api/oauth/codex/test
 *
 * Tests a Codex access token by making a simple API request to OpenAI.
 */
export async function POST(request: Request) {
  const { accessToken } = (await request.json()) as { accessToken: string };

  if (!accessToken) {
    return NextResponse.json(
      { error: "Missing access token" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 50,
        messages: [{ role: "user", content: "Say hello in one sentence!" }],
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 }
    );
  }
}
