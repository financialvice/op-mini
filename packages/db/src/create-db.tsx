import type {
  InstantConfig,
  InstantReactAbstractDatabase,
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

  return {
    useAuth: () => client.useAuth(),
    useUser: () => client.useUser(),
    auth: client.auth,
    SignedIn: client.SignedIn,
    SignedOut: client.SignedOut,
    RedirectSignedOut,
    RedirectSignedIn,
    Redirect,
    getAuth: () => client.getAuth(),
    // Expose the raw client for devtools
    _client: client,
  };
};

export type Db = ReturnType<typeof createDb<InstantClient>>;
