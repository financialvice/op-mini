"use client";

import { useTRPC } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export default function TemplatesPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Morph templates
  const { data: morphTemplates } = useQuery(
    trpc.morph.templates.list.queryOptions()
  );
  const { mutateAsync: createMorphTemplate, isPending: creatingMorph } =
    useMutation(
      trpc.morph.templates.create.mutationOptions({
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: trpc.morph.templates.list.queryKey(),
          }),
      })
    );

  // Hetzner templates
  const { data: hetznerTemplates } = useQuery(
    trpc.hetzner.templates.list.queryOptions()
  );
  const { mutateAsync: createHetznerTemplate, isPending: creatingHetzner } =
    useMutation(
      trpc.hetzner.templates.create.mutationOptions({
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: trpc.hetzner.templates.list.queryKey(),
          }),
      })
    );
  const { mutateAsync: ensureSshKey } = useMutation(
    trpc.hetzner.sshKeys.ensure.mutationOptions()
  );

  return (
    <div className="flex flex-col gap-6 p-4">
      <h1 className="font-bold text-2xl">Templates</h1>

      <div className="grid grid-cols-2 gap-8">
        {/* Morph Templates */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-lg">Morph</h2>
            <button
              className="rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
              disabled={creatingMorph}
              onClick={() => createMorphTemplate({ name: "devbox" })}
              type="button"
            >
              {creatingMorph ? "Creating..." : "Create devbox"}
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {morphTemplates?.templates.map((template) => (
              <div
                className="rounded border px-2 py-1 font-mono text-sm"
                key={template.id}
              >
                {template.metadata?.name ?? template.id}
              </div>
            ))}
            {morphTemplates?.templates.length === 0 && (
              <div className="text-gray-500 text-sm">No templates</div>
            )}
          </div>
        </div>

        {/* Hetzner Templates */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-lg">Hetzner</h2>
            <button
              className="rounded bg-green-600 px-2 py-1 text-sm text-white hover:bg-green-500 disabled:opacity-50"
              disabled={creatingHetzner}
              onClick={async () => {
                await ensureSshKey();
                await createHetznerTemplate({ name: "devbox" });
              }}
              type="button"
            >
              {creatingHetzner ? "Creating..." : "Create devbox"}
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {hetznerTemplates?.map((template) => (
              <div
                className="flex items-center justify-between rounded border px-2 py-1 font-mono text-sm"
                key={template.id}
              >
                <span>{template.labels?.name ?? template.description}</span>
                <span
                  className={
                    template.status === "available"
                      ? "text-green-500"
                      : "text-yellow-500"
                  }
                >
                  {template.status}
                </span>
              </div>
            ))}
            {hetznerTemplates?.length === 0 && (
              <div className="text-gray-500 text-sm">No templates</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
