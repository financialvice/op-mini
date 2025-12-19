import { QueryClient } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchStreamLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import {
  createTRPCContext,
  createTRPCOptionsProxy,
} from "@trpc/tanstack-react-query";
import SuperJSON from "superjson";
import type { AppRouter } from "./app-router";

export type { AppRouter } from "./app-router";

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return "";
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 1000 * 60 * 60 * 24, // 24 hours - required for persistence
      refetchOnWindowFocus: false,
    },
  },
});

// Token getter - set by the app when auth is available
let getAuthToken: (() => string | undefined) | undefined;

export const setAuthTokenGetter = (getter: () => string | undefined) => {
  getAuthToken = getter;
};

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      // uses the httpSubscriptionLink for subscriptions
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({
        url: `${getBaseUrl()}/api/trpc`,
        transformer: SuperJSON,
      }),
      false: httpBatchStreamLink({
        url: `${getBaseUrl()}/api/trpc`,
        transformer: SuperJSON,
        headers() {
          const token = getAuthToken?.();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    }),
  ],
});

// Create context for React integration
export const { TRPCProvider, useTRPC, useTRPCClient } =
  createTRPCContext<AppRouter>();

// Also export singleton for direct usage if needed
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
