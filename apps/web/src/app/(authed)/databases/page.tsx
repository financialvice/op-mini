"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { db } from "@repo/db";
import { useTRPC } from "@repo/trpc/client";
import { Button } from "@repo/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

const createAppSchema = z.object({
  name: z.string().min(2, "App name must be at least 2 characters"),
});

type CreateAppForm = z.infer<typeof createAppSchema>;

export default function AppsPage() {
  const trpc = useTRPC();
  const { team, org, apps, isLoading } = db.useWorkspace();

  const form = useForm<CreateAppForm>({
    resolver: zodResolver(createAppSchema),
    defaultValues: { name: "" },
  });

  const { mutateAsync: createApp, isPending: isCreating } = useMutation(
    trpc.instantdb.apps.create.mutationOptions({
      onSuccess: () => {
        form.reset();
      },
    })
  );

  const { mutateAsync: deleteApp } = useMutation(
    trpc.instantdb.apps.delete.mutationOptions()
  );

  const onSubmit = async (data: CreateAppForm) => {
    if (!(team && org)) {
      return;
    }
    await createApp({
      teamId: team.id,
      orgId: org.id,
      externalOrgId: org.externalOrgId,
      name: data.name,
    });
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="font-semibold text-xl">Databases</h1>
      </div>

      <form
        className="flex max-w-sm flex-col items-end gap-2"
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field className="flex-1" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>New database</FieldLabel>
              <Input
                {...field}
                aria-invalid={fieldState.invalid}
                autoComplete="off"
                id={field.name}
                placeholder="my-database"
              />
              <FieldDescription>Create a new database.</FieldDescription>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Button disabled={isCreating} type="submit">
          {isCreating ? "Creating..." : "Create"}
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        {isLoading && (
          <p className="text-muted-foreground text-sm">Loading...</p>
        )}
        {apps.map((app) => (
          <div
            className="flex items-center justify-between rounded border p-3"
            key={app.id}
          >
            <div>
              <div className="font-medium">{app.name}</div>
              <div className="font-mono text-muted-foreground text-xs">
                {app.externalAppId}
              </div>
            </div>
            <Button
              onClick={() => {
                // we intentionally delete the app locally first to get instant feedback
                // because instantdb apps are free, it is inconsequential if the deletion of the external resource fails
                db._client.transact([
                  db._client.tx.instantDbApps[app.id]!.delete(),
                ]);
                deleteApp({ externalAppId: app.externalAppId });
              }}
              size="sm"
              variant="destructive"
            >
              Delete
            </Button>
          </div>
        ))}
        {!isLoading && apps.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No databases yet. Create one above.
          </p>
        )}
      </div>
    </div>
  );
}
