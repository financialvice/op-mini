import {
  type InstantConfig,
  type InstantReactAbstractDatabase,
  id as newId,
} from "@instantdb/react";
import { useEffect } from "react";
import type { AppSchema } from "./instant.schema";

/**
 * Binds the Instant client to a tiny facade we can share between platforms.
 * While the name mentions "db", the returned object exposes hooks, auth
 * helpers, and rendering guards that power the Expo protected routes flow.
 */
type InstantClient = InstantReactAbstractDatabase<
  AppSchema,
  InstantConfig<AppSchema, true>
>;

/**
 * Builds the platform-aware `db` facade by wiring shared hook factories to a
 * concrete InstantDB client. Each entry point (`index.ts` for web,
 * `index.native.ts` for React Native) calls this with its respective
 * initializer.
 */
export const createDb = <Client extends InstantClient>(client: Client) => {
  function SignedIn({ children }: { children: React.ReactNode }) {
    return <client.SignedIn>{children}</client.SignedIn>;
  }

  function SignedOut({ children }: { children: React.ReactNode }) {
    return <client.SignedOut>{children}</client.SignedOut>;
  }

  function Redirect({ onRedirect }: { onRedirect: () => void }) {
    useEffect(() => {
      onRedirect();
    }, [onRedirect]);

    return null;
  }

  function RedirectSignedOut({ onRedirect }: { onRedirect: () => void }) {
    return (
      <SignedOut>
        <Redirect onRedirect={onRedirect} />
      </SignedOut>
    );
  }

  function RedirectSignedIn({ onRedirect }: { onRedirect: () => void }) {
    return (
      <SignedIn>
        <Redirect onRedirect={onRedirect} />
      </SignedIn>
    );
  }

  /*
   * OAuth Token Management
   */
  const useOAuthToken = (provider: string) => {
    const { id } = client.useUser();
    const { data, isLoading, error } = client.useQuery({
      oauthTokens: {
        $: {
          where: {
            "user.id": id,
            provider,
          },
          order: { createdAt: "desc" },
          limit: 1,
        },
      },
    });

    const token = data?.oauthTokens?.at(0);
    const isExpired = token?.expiresAt
      ? new Date(token.expiresAt) < new Date()
      : false;

    return {
      token,
      isExpired,
      isLoading,
      error,
    };
  };

  const saveOAuthToken = async (
    userId: string,
    tokenData: {
      provider: string;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }
  ) => {
    if (!userId) {
      return;
    }

    const tokenId = newId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokenData.expiresIn * 1000);

    await client.transact([
      client.tx.oauthTokens[tokenId]!.create({
        provider: tokenData.provider,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt,
        createdAt: now,
      }).link({
        user: userId,
      }),
    ]);

    return tokenId;
  };

  const updateOAuthToken = async (
    tokenId: string,
    tokenData: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }
  ) => {
    if (!tokenId) {
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokenData.expiresIn * 1000);

    await client.transact([
      client.tx.oauthTokens[tokenId]!.update({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt,
        lastRefreshedAt: now,
      }),
    ]);
  };

  const deleteOAuthToken = async (tokenId: string) => {
    if (!tokenId) {
      return;
    }

    await client.transact([client.tx.oauthTokens[tokenId]!.delete()]);
  };

  /**
   * Get user's workspace: team membership with nested org and apps.
   * Single query that fetches everything needed for the workspace context.
   */
  const useWorkspace = () => {
    const { id } = client.useUser();
    const { data, isLoading, error } = client.useQuery(
      id
        ? {
            teamMemberships: {
              $: { where: { "user.id": id } },
              team: {
                instantDbOrg: {},
                instantDbApps: {},
              },
            },
          }
        : null
    );

    const membership = data?.teamMemberships?.[0];
    const team = membership?.team;

    return {
      membership,
      team,
      org: team?.instantDbOrg,
      apps: team?.instantDbApps ?? [],
      isLoading,
      error,
    };
  };

  return {
    useAuth: () => client.useAuth(),
    useUser: () => client.useUser(),
    auth: client.auth,
    SignedIn: client.SignedIn,
    SignedOut: client.SignedOut,
    useOAuthToken,
    saveOAuthToken,
    updateOAuthToken,
    deleteOAuthToken,
    RedirectSignedOut,
    RedirectSignedIn,
    Redirect,
    getAuth: () => client.getAuth(),
    useWorkspace,
    // Expose the raw client for devtools
    _client: client,
  };
};

export type Db = ReturnType<typeof createDb<InstantClient>>;
