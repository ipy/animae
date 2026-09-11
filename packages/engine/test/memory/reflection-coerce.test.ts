import { describe, expect, test } from "bun:test";
import { ReflectionResponseSchema, coerceReflectionRaw } from "../../src/memory/reflection.ts";

describe("coerceReflectionRaw", () => {
  test("maps reflection/memories drift", () => {
    const coerced = coerceReflectionRaw({
      reflection: "Scene felt tense.",
      memories: ["water ration"],
      emotions: "uneasy",
    });
    const parsed = ReflectionResponseSchema.parse(coerced);
    expect(parsed.summaries.length).toBeGreaterThan(0);
    expect(parsed.goal_changes).toEqual([]);
  });
});
