"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { db } from "@repo/db";
import { setAuthTokenGetter, useTRPC } from "@repo/trpc/client";
import { Button } from "@repo/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { SidebarProvider } from "@repo/ui/components/sidebar";
import { useMutation } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { AppSidebar } from "../../components/app-sidebar";
import { StatusBar } from "../../components/status-bar";

const setupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
});

type SetupFormData = z.infer<typeof setupSchema>;

function SetupForm() {
  const trpc = useTRPC();

  const form = useForm<SetupFormData>({
    resolver: zodResolver(setupSchema),
    defaultValues: { name: "" },
  });

  const { mutateAsync: createTeam, isPending } = useMutation(
    trpc.instantdb.teams.create.mutationOptions()
  );

  const onSubmit = async (data: SetupFormData) => {
    await createTeam({ name: data.name });
    // No redirect needed - InstantDB will update and guard will render children
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form
        className="flex w-full max-w-sm flex-col gap-6"
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <div>
          <h1 className="font-semibold text-xl">Setup your workspace</h1>
          <p className="text-muted-foreground text-sm">
            Create a team to get started.
          </p>
        </div>

        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Team name</FieldLabel>
              <Input
                {...field}
                aria-invalid={fieldState.invalid}
                autoComplete="off"
                id={field.name}
                placeholder="My Team"
              />
              <FieldDescription>
                Your team groups users and apps together.
              </FieldDescription>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Button disabled={isPending} type="submit">
          {isPending ? "Creating..." : "Continue"}
        </Button>
      </form>
    </div>
  );
}

function SetupGuard({ children }: { children: ReactNode }) {
  const { team, org, isLoading } = db.useWorkspace();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!(team && org)) {
    return <SetupForm />;
  }

  return <>{children}</>;
}

export default function AuthedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user } = db._client.useAuth();

  const path = usePathname();

  // Set up auth token for tRPC
  useEffect(() => {
    // instant calls this refresh_token (its their access token)
    setAuthTokenGetter(() => user?.refresh_token);
  }, [user?.refresh_token]);

  return (
    <>
      <db.RedirectSignedOut onRedirect={() => router.push("/login")} />
      <db.SignedIn>
        <SetupGuard>
          <div className="flex h-screen max-h-screen flex-col">
            <SidebarProvider className="!min-h-auto h-full w-full">
              {path !== "/canvas" && <AppSidebar />}
              {path !== "/canvas" ? (
                <main className="flex-1 overflow-hidden">{children}</main>
              ) : (
                children
              )}
            </SidebarProvider>
            <StatusBar />
          </div>
        </SetupGuard>
      </db.SignedIn>
    </>
  );
}
