"use client";

import { db } from "@repo/db";
import { useTRPC } from "@repo/trpc/client";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@repo/ui/components/input-otp";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const bypassAuth =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_BYPASS_AUTH === "true";

export default function LoginPage() {
  const router = useRouter();

  return (
    <>
      <db.SignedOut>
        <Login />
      </db.SignedOut>
      <db.RedirectSignedIn onRedirect={() => router.push("/")} />
    </>
  );
}

function Login() {
  const [sentEmail, setSentEmail] = useState("");

  return (
    <div className="flex min-h-screen">
      <div className="hidden flex-1 items-center justify-center p-3 md:flex">
        <div className="relative h-full w-full overflow-hidden rounded-lg bg-muted">
          <div className="relative h-full w-full bg-muted" />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {sentEmail ? (
            <CodeStep onBack={() => setSentEmail("")} sentEmail={sentEmail} />
          ) : (
            <EmailStep onSendEmail={setSentEmail} />
          )}
        </div>
      </div>
    </div>
  );
}

function EmailStep({ onSendEmail }: { onSendEmail: (email: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const trpc = useTRPC();
  const devSignIn = useMutation(trpc.auth.devSignIn.mutationOptions());

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const inputEl = inputRef.current;
    if (!inputEl) {
      return;
    }
    const email = inputEl.value;

    // In dev mode or when bypass is enabled, skip email verification
    if (bypassAuth) {
      try {
        const { token } = await devSignIn.mutateAsync({ email });
        await db.auth.signInWithToken(token);
      } catch (err) {
        alert(`Dev sign-in failed: ${(err as Error).message}`);
      }
      return;
    }

    onSendEmail(email);
    db.auth.sendMagicCode({ email }).catch((err) => {
      alert(`Uh oh : ${err.body?.message}`);
      onSendEmail("");
    });
  };

  const appName = "{{App}}";

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle className="text-center text-lg">
          Welcome to {appName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-center text-muted-foreground">
          New here or coming back? Enter your email below to get started.
        </p>
        <form
          className="flex flex-col space-y-2"
          key="email"
          onSubmit={handleSubmit}
        >
          <Input
            autoFocus
            placeholder="Enter your email"
            ref={inputRef}
            required
            type="email"
          />
          <Button className="w-full" type="submit">
            Send Code
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CodeStep({
  sentEmail,
  onBack,
}: {
  sentEmail: string;
  onBack: () => void;
}) {
  const [value, setValue] = useState("");
  const [isResending, setIsResending] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (value.length !== 6) {
      return;
    }
    db.auth
      .signInWithMagicCode({ email: sentEmail, code: value })
      .catch((err) => {
        setValue("");
        alert(`Uh oh : ${err.body?.message}`);
      });
  };

  const handleResend = async () => {
    setIsResending(true);
    try {
      await db.auth.sendMagicCode({ email: sentEmail });
      alert("Code resent! Check your email.");
    } catch (err) {
      alert(
        `Failed to resend code: ${(err as Error & { body?: { message?: string } })?.body?.message || "Unknown error"}`
      );
    } finally {
      setIsResending(false);
    }
  };

  const handleSetValue = (newValue: string) => {
    setValue(newValue);
    if (value.length === 6) {
      db.auth
        .signInWithMagicCode({ email: sentEmail, code: value })
        .catch((err) => {
          setValue("");
          alert(`Uh oh : ${err.body?.message}`);
        });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center text-lg">Enter your code</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col space-y-4"
          key="code"
          onSubmit={handleSubmit}
        >
          <p className="text-center text-muted-foreground">
            We sent an email to <strong>{sentEmail}</strong>. Check your email,
            and paste the code you see.
          </p>
          <div className="flex justify-center">
            <InputOTP
              autoFocus
              maxLength={6}
              onChange={handleSetValue}
              value={value}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <div className="flex flex-col gap-2">
            <Button className="w-full" type="submit">
              Verify Code
            </Button>
            <Button
              className="w-full"
              disabled={isResending}
              onClick={handleResend}
              type="button"
              variant="outline"
            >
              {isResending
                ? "Resending..."
                : "Didn't receive a code? Resend code"}
            </Button>
            <Button
              className="w-full"
              onClick={onBack}
              type="button"
              variant="ghost"
            >
              Back to email
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
