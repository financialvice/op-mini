import { z } from "zod";
import { t } from "../server";

const ANTHROPIC_OAUTH_CONFIG = {
  tokenUrl: "https://console.anthropic.com/v1/oauth/token",
  betaHeader: "oauth-2025-04-20",
};

const OPENAI_AUTH_CONFIG = {
  baseUrl: "https://auth.openai.com",
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  deviceAuthCallback: "https://auth.openai.com/deviceauth/callback",
};

const VERCEL_CLIENT_ID = process.env.VERCEL_CLIENT_ID!;
const VERCEL_CLIENT_SECRET = process.env.VERCEL_CLIENT_SECRET!;

export const oauthRouter = t.router({
  /**
   * Exchange authorization code for tokens with Anthropic's OAuth endpoint.
   * Proxies the request to avoid CORS issues.
   */
  anthropicToken: t.procedure
    .input(z.record(z.string(), z.unknown()))
    .mutation(async ({ input }) => {
      const response = await fetch(ANTHROPIC_OAUTH_CONFIG.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-beta": ANTHROPIC_OAUTH_CONFIG.betaHeader,
        },
        body: JSON.stringify(input),
      });

      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        return { error: data, status: response.status };
      }

      return { data };
    }),

  /**
   * Test an Anthropic access token by making a simple API request.
   */
  anthropicTest: t.procedure
    .input(z.object({ accessToken: z.string() }))
    .mutation(async ({ input }) => {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "oauth-2025-04-20",
          Authorization: `Bearer ${input.accessToken}`,
        },
        body: JSON.stringify({
          model: "haiku",
          max_tokens: 50,
          messages: [{ role: "user", content: "Say hello in one sentence!" }],
        }),
      });

      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        return { error: data, status: response.status };
      }

      return { data };
    }),

  /**
   * Refresh a Vercel access token.
   */
  vercelRefresh: t.procedure
    .input(z.object({ refreshToken: z.string() }))
    .mutation(async ({ input }) => {
      const response = await fetch("https://api.vercel.com/login/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: VERCEL_CLIENT_ID,
          client_secret: VERCEL_CLIENT_SECRET,
          refresh_token: input.refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Vercel token refresh failed:", errorText);
        return { error: "Token refresh failed", status: response.status };
      }

      const data = (await response.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
        refresh_token?: string;
      };

      return { data };
    }),

  /**
   * Initiate the device authorization flow for Codex (OpenAI).
   * Returns the device_auth_id, user_code, and polling interval.
   */
  codexDeviceInit: t.procedure.mutation(async () => {
    const response = await fetch(
      `${OPENAI_AUTH_CONFIG.baseUrl}/api/accounts/deviceauth/usercode`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: OPENAI_AUTH_CONFIG.clientId }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { error: `Failed to get device code: ${errorText}` };
    }

    const data = (await response.json()) as {
      device_auth_id: string;
      user_code: string;
      interval: number | string;
    };

    return {
      data: {
        device_auth_id: data.device_auth_id,
        user_code: data.user_code,
        interval: Number(data.interval) || 5,
        verification_url: `${OPENAI_AUTH_CONFIG.baseUrl}/codex/device`,
        expires_in: 15 * 60, // 15 minutes
      },
    };
  }),

  /**
   * Poll the device auth status for Codex (OpenAI).
   * Returns pending status or complete with tokens.
   */
  codexDevicePoll: t.procedure
    .input(
      z.object({
        deviceAuthId: z.string(),
        userCode: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      // Poll the device auth token endpoint
      const pollResponse = await fetch(
        `${OPENAI_AUTH_CONFIG.baseUrl}/api/accounts/deviceauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_auth_id: input.deviceAuthId,
            user_code: input.userCode,
          }),
        }
      );

      // 403/404/428 means still pending
      if ([403, 404, 428].includes(pollResponse.status)) {
        return { status: "pending" as const };
      }

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text();
        return { error: `Device auth failed: ${errorText}` };
      }

      // Success - we got the authorization code
      const authData = (await pollResponse.json()) as {
        authorization_code: string;
        code_challenge: string;
        code_verifier: string;
      };

      // Exchange the authorization code for tokens
      const tokenResponse = await fetch(
        `${OPENAI_AUTH_CONFIG.baseUrl}/oauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authData.authorization_code,
            redirect_uri: OPENAI_AUTH_CONFIG.deviceAuthCallback,
            client_id: OPENAI_AUTH_CONFIG.clientId,
            code_verifier: authData.code_verifier,
          }).toString(),
        }
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        return { error: `Token exchange failed: ${errorText}` };
      }

      const tokens = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token?: string;
        id_token?: string;
        token_type?: string;
        expires_in?: number;
      };

      return {
        status: "complete" as const,
        tokens: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          id_token: tokens.id_token,
          expires_in: tokens.expires_in,
        },
      };
    }),

  /**
   * Refresh a Codex (OpenAI) access token.
   */
  codexRefresh: t.procedure
    .input(
      z.object({
        refreshToken: z.string(),
        clientId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const formData = new URLSearchParams({
        client_id: input.clientId ?? OPENAI_AUTH_CONFIG.clientId,
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
        scope: "openid profile email",
      });

      const response = await fetch(
        `${OPENAI_AUTH_CONFIG.baseUrl}/oauth/token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        }
      );

      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        return { error: data, status: response.status };
      }

      return { data };
    }),

  /**
   * Test a Codex (OpenAI) access token by making a simple API request.
   */
  codexTest: t.procedure
    .input(z.object({ accessToken: z.string() }))
    .mutation(async ({ input }) => {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${input.accessToken}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 50,
            messages: [{ role: "user", content: "Say hello in one sentence!" }],
          }),
        }
      );

      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        return { error: data, status: response.status };
      }

      return { data };
    }),
});
