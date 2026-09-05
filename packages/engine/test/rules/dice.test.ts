import { test, expect } from "bun:test";
import { createRng } from "../../src/timeline/rng.ts";
import { check, parseDice, rollDice } from "../../src/rules/dice.ts";

test("parseDice accepts NdM[kh|klK][±C]", () => {
  expect(parseDice("2d20kh1+5").n).toBe(2);
  expect(parseDice("4d6kh3").keep).toBe("kh");
  expect(parseDice("1d20").modifier).toBe(0);
});

test("advantage and disadvantage cancel on d20", () => {
  const rng = createRng(42, "main", "dice-test");
  const r = rollDice("1d20", rng, { advantage: true, disadvantage: true });
  expect(r.rolls.length).toBe(1);
});

test("check success margin", () => {
  const rng = createRng(1, "main", "check-fixed");
  const r = check({ expr: "1d20", dc: 1, rng });
  expect(r.success).toBe(true);
  expect(r.margin).toBe(r.total - 1);
});
