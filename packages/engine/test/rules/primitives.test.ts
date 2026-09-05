import { test, expect } from "bun:test";
import { applyTurnCap, computeDelta, marginal, tierFor } from "../../src/rules/primitives.ts";

test("marginal k=0.5", () => {
  expect(marginal(0, 0.5)).toBe(1);
  expect(marginal(1, 0.5)).toBeCloseTo(1 / 1.5);
});

test("computeDelta care worked example", () => {
  const d = computeDelta({
    base: 4,
    intensity: 1,
    sincerity: 0.8,
    sincerityFactor: 0.8,
    traitMult: 1,
    marginal: 1,
    trackMult: 1,
  });
  expect(d).toBe(3.2);
});

test("tierFor hysteresis up and down", () => {
  const tiers = [
    { name: "low", from: 0 },
    { name: "high", from: 60 },
  ];
  expect(tierFor(59, tiers, "low", 3).tier).toBe("low");
  expect(tierFor(63, tiers, "low", 3).tier).toBe("high");
  expect(tierFor(58, tiers, "high", 3).tier).toBe("high");
  expect(tierFor(56, tiers, "high", 3).tier).toBe("low");
});

test("applyTurnCap clamps cumulative delta", () => {
  const first = applyTurnCap(6, "affinity", {}, 8);
  expect(first.delta).toBe(6);
  const second = applyTurnCap(5, "affinity", first.acc, 8);
  expect(second.delta).toBe(2);
});
