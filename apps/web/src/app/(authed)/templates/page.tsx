"use client";

import { useTRPC } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export default function TemplatesPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: templatesData } = useQuery(
    trpc.morph.templates.list.queryOptions()
  );
  const { mutateAsync: createTemplate } = useMutation(
    trpc.morph.templates.create.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.morph.templates.list.queryKey(),
        }),
    })
  );
  return (
    <div>
      <h1>Templates</h1>
      <button
        onClick={async () => {
          await createTemplate({ name: "devbox" });
        }}
        type="button"
      >
        Create Template
      </button>
      <div className="grid grid-cols-4 gap-2">
        {templatesData?.templates.map((template) => (
          <div key={template.id}>{template.metadata?.name}</div>
        ))}
      </div>
    </div>
  );
}
