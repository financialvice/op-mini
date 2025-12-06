import { beforeEach, describe, expect, it } from "vitest";
import { helloRouter } from "../../src/routers/hello";

describe("Hello Router", () => {
  let caller: ReturnType<typeof helloRouter.createCaller>;

  beforeEach(() => {
    caller = helloRouter.createCaller({});
  });

  describe("hello procedure", () => {
    it("should return greeting with provided name", async () => {
      const result = await caller.hello({ name: "World" });
      expect(result).toBe("Hello, World!");
    });

    it("should return greeting with different names", async () => {
      const result1 = await caller.hello({ name: "Alice" });
      expect(result1).toBe("Hello, Alice!");

      const result2 = await caller.hello({ name: "Bob" });
      expect(result2).toBe("Hello, Bob!");
    });

    it("should handle special characters in name", async () => {
      const result = await caller.hello({ name: "你好" });
      expect(result).toBe("Hello, 你好!");
    });

    it("should handle empty string", async () => {
      const result = await caller.hello({ name: "" });
      expect(result).toBe("Hello, !");
    });

    it("should validate input with Zod schema", async () => {
      await expect(
        // @ts-expect-error Testing invalid input
        caller.hello({ name: 123 })
      ).rejects.toThrow();

      await expect(
        // @ts-expect-error Testing missing input
        caller.hello({})
      ).rejects.toThrow();

      await expect(
        // @ts-expect-error Testing null input
        caller.hello({ name: null })
      ).rejects.toThrow();
    });

    it("should have correct procedure structure", () => {
      expect(helloRouter._def.procedures.hello).toBeDefined();
      expect(helloRouter._def.procedures.hello._def.type).toBe("query");
    });
  });

  describe("router structure", () => {
    it("should be a valid tRPC router", () => {
      expect(helloRouter._def).toBeDefined();
      expect(helloRouter._def.procedures).toBeDefined();
    });

    it("should only have hello procedure", () => {
      const procedures = Object.keys(helloRouter._def.procedures);
      expect(procedures).toHaveLength(1);
      expect(procedures).toContain("hello");
    });
  });

  describe("input validation", () => {
    it("should accept valid string input", async () => {
      const validInputs = [
        "Test",
        "A very long name with spaces",
        "123",
        "Name-with-hyphens",
        "Name_with_underscores",
      ];

      const results = await Promise.all(
        validInputs.map((name) => caller.hello({ name }))
      );
      expect(results).toEqual(validInputs.map((n) => `Hello, ${n}!`));
    });

    it("should reject invalid input types", async () => {
      const invalidInputs = [
        { name: undefined },
        { name: 123 },
        { name: true },
        { name: [] },
        { name: {} },
      ];

      await Promise.all(
        invalidInputs.map(async (input) => {
          await expect(
            // @ts-expect-error Testing invalid input types
            caller.hello(input)
          ).rejects.toThrow();
        })
      );
    });

    it("should require name field", async () => {
      await expect(
        // @ts-expect-error Testing missing field
        caller.hello({})
      ).rejects.toThrow();

      await expect(
        // @ts-expect-error Testing wrong field name
        caller.hello({ username: "Test" })
      ).rejects.toThrow();
    });
  });
});
