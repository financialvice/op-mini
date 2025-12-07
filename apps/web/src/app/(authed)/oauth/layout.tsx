"use client";

import { db } from "@repo/db";
import { useRouter } from "next/navigation";

export default function OAuthPlaygroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <>
      <db.RedirectSignedOut onRedirect={() => router.push("/login")} />
      <db.SignedIn>{children}</db.SignedIn>
    </>
  );
}
