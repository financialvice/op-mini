import type { AddressInfo } from "node:net";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import SuperJSON from "superjson";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { t } from "../src/server";

// Validate SuperJSON over real HTTP transport (not createCaller)
describe("Transport + SuperJSON", () => {
  const router = t.router({
    date: t.procedure.query(() => new Date("2024-01-01T00:00:00.000Z")),
    bigint: t.procedure.query(() => 123n),
    zodError: t.procedure.query(() => {
      // Simulate an input error downstream by throwing a TRPCError
      throw new TRPCError({ code: "BAD_REQUEST", message: "nope" });
    }),
  });

  const server = createHTTPServer({
    router,
    createContext: () => ({}),
  });

  let baseURL = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const address = server.address() as AddressInfo | null;
    if (!address || typeof address.port !== "number") {
      throw new Error("Failed to obtain server address");
    }
    baseURL = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("round-trips Date via SuperJSON", async () => {
    const client = createTRPCClient<typeof router>({
      links: [httpBatchLink({ url: baseURL, transformer: SuperJSON })],
    });

    const d = await client.date.query();
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("round-trips BigInt via SuperJSON", async () => {
    const client = createTRPCClient<typeof router>({
      links: [httpBatchLink({ url: baseURL, transformer: SuperJSON })],
    });

    const value = await client.bigint.query();
    expect(typeof value).toBe("bigint");
    expect(value).toBe(123n);
  });

  it("returns structured TRPCError over transport", async () => {
    const client = createTRPCClient<typeof router>({
      links: [httpBatchLink({ url: baseURL, transformer: SuperJSON })],
    });

    await expect(client.zodError.query()).rejects.toMatchObject({
      data: { code: "BAD_REQUEST" },
    });
  });
});
