import type {
  inferRouterInputs,
  inferRouterOutputs,
  TRPCError,
} from "@trpc/server";
import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { type AppRouter, appRouter } from "../src/app-router";
import { helloRouter } from "../src/routers/hello";
import { t } from "../src/server";

describe("App Router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    caller = appRouter.createCaller({});
  });

  describe("router types", () => {
    it("exports AppRouter type and shapes", () => {
      const value: AppRouter = appRouter;
      expect(value).toBeDefined();
      type RouterInputs = inferRouterInputs<AppRouter>;
      type RouterOutputs = inferRouterOutputs<AppRouter>;
      expectTypeOf<RouterInputs["hello"]["hello"]>().toEqualTypeOf<{
        name: string;
      }>();
      expectTypeOf<RouterOutputs["hello"]["hello"]>().toEqualTypeOf<string>();
    });
  });

  describe("hello router integration", () => {
    it("should be able to call hello.hello procedure", async () => {
      const result = await caller.hello.hello({ name: "Integration Test" });
      expect(result).toBe("Hello, Integration Test!");
    });

    it("should maintain the same behavior as standalone router", async () => {
      const directCallerResult = await helloRouter
        .createCaller({})
        .hello({ name: "Direct" });
      const appRouterResult = await caller.hello.hello({ name: "Direct" });

      expect(appRouterResult).toBe(directCallerResult);
    });

    it("should handle validation errors with structured TRPCError", async () => {
      await expect(
        // @ts-expect-error invalid input shape on purpose
        caller.hello.hello({ name: 123 })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST" satisfies TRPCError["code"],
      });
    });
  });

  describe("type inference", () => {
    it("should correctly infer input types", () => {
      type RouterInputs = inferRouterInputs<AppRouter>;
      type HelloInput = RouterInputs["hello"]["hello"];

      const validInput: HelloInput = { name: "Test" };
      expect(validInput).toEqual({ name: "Test" });
    });

    it("should correctly infer output types", () => {
      type RouterOutputs = inferRouterOutputs<AppRouter>;
      type HelloOutput = RouterOutputs["hello"]["hello"];

      const expectedOutput: HelloOutput = "Hello, Test!";
      expect(typeof expectedOutput).toBe("string");
    });
  });

  describe("error handling", () => {
    it("propagates Zod validation failures via TRPCError", async () => {
      await expect(
        // @ts-expect-error wrong field name
        caller.hello.hello({ wrongField: "test" })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      await expect(
        // @ts-expect-error missing required field
        caller.hello.hello({})
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // Transformer behavior is validated over transport in a separate test.

  describe("multiple router composition", () => {
    it("should be able to add more routers", async () => {
      const extendedRouter = t.router({
        hello: helloRouter,
        test: t.router({
          ping: t.procedure.query(() => "pong"),
        }),
      });

      const extendedCaller = extendedRouter.createCaller({});
      const pingResult = await extendedCaller.test.ping();

      expect(pingResult).toBe("pong");
    });
  });
});
