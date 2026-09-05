import { test, expect } from "bun:test";
import { createCelEngine } from "../../src/rules/cel.ts";

test("CEL compares track doubles to int literals", () => {
  const cel = createCelEngine();
  const ctx = { tracks: { affinity: 35 }, event: { intensity: 0.6 } };
  expect(cel.bool("tracks.affinity < 40 && event.intensity > 0.5", ctx)).toBe(true);
  expect(cel.num("tracks.affinity + 5", ctx)).toBe(40);
});

test("CEL check catches syntax errors", () => {
  const cel = createCelEngine();
  expect(cel.check("1 +")).toBeDefined();
});
