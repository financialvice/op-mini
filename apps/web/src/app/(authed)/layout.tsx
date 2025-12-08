"use client";

import { db } from "@repo/db";
import { SidebarProvider } from "@repo/ui/components/sidebar";
import { useRouter } from "next/navigation";
import { AppSidebar } from "../../components/app-sidebar";
import { StatusBar } from "../../components/status-bar";

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <>
      <db.RedirectSignedOut onRedirect={() => router.push("/login")} />
      <db.SignedIn>
        <SidebarProvider>
          <AppSidebar />
          <main className="relative h-screen flex-1 overflow-hidden pb-6">
            {children}
          </main>
          <StatusBar />
        </SidebarProvider>
      </db.SignedIn>
    </>
  );
}
