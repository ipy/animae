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

  test("drops keys a model adds on its own instead of rejecting the reflection", () => {
    const parsed = ReflectionResponseSchema.parse({
      summaries: ["They shared the last ration."],
      goal_changes: [{ action: "add", text: "Repay the favour", tags: ["debt"], reason: "felt owed", confidence: 0.8 }],
      new_claims: [{ s: "mei", p: "owes", o: "player", confidence: 0.9 }],
      mood: "warm",
    });
    expect(parsed.goal_changes).toEqual([{ action: "add", text: "Repay the favour", tags: ["debt"] }]);
    expect(parsed.new_claims).toEqual([{ s: "mei", p: "owes", o: "player" }]);
    expect(parsed).not.toHaveProperty("mood");
  });
});
