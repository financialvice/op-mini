"use client";

import { queryClient, TRPCProvider, trpcClient } from "@repo/trpc/client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

export function TRPCTanStackReactQueryProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
