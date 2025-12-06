import type { ReactNode } from "react";
import { TRPCTanStackReactQueryProvider } from "./trpc-tanstack-react-query-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TRPCTanStackReactQueryProvider>{children}</TRPCTanStackReactQueryProvider>
  );
}
