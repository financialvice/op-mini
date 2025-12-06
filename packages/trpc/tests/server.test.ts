import { describe, expect, it } from "vitest";
import { t } from "../src/server";

describe("tRPC Server Basics", () => {
  it("exposes router and procedure creators", () => {
    expect(typeof t.router).toBe("function");
    expect("query" in t.procedure).toBe(true);
    expect("mutation" in t.procedure).toBe(true);
  });

  it("creates a router and executes a query", async () => {
    const testRouter = t.router({
      ping: t.procedure.query(() => "pong"),
    });
    const caller = testRouter.createCaller({});
    await expect(caller.ping()).resolves.toBe("pong");
  });
});
