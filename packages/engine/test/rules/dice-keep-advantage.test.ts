import { describe, expect, test } from "bun:test";
import { createRng } from "../../src/timeline/rng.ts";
import { parseDice, rollDice } from "../../src/rules/dice.ts";
import { AnimaeError } from "../../src/types.ts";

describe("dice keep and advantage", () => {
  test("invalid keep count throws DICE_INVALID", () => {
    expect(() => parseDice("2d6kh3")).toThrow(AnimaeError);
    expect(() => parseDice("2d6kl0")).toThrow(AnimaeError);
  });

  test("keep highest sums subset of rolls", () => {
    const rng = createRng(99, "main", "keep");
    const r = rollDice("4d6kh3", rng);
    expect(r.kept.length).toBe(3);
    expect(r.total).toBe(r.kept.reduce((a, b) => a + b, 0) + r.modifier);
  });

  test("advantage on 1d20 keeps higher of two d20 rolls", () => {
    const rng = createRng(7, "main", "adv");
    const r = rollDice("1d20", rng, { advantage: true });
    expect(r.rolls.length).toBe(2);
    expect(r.kept[0]).toBe(Math.max(r.rolls[0]!, r.rolls[1]!));
  });

  test("disadvantage on 1d20 keeps lower roll", () => {
    const rng = createRng(7, "main", "dis");
    const r = rollDice("1d20", rng, { disadvantage: true });
    expect(r.kept[0]).toBe(Math.min(r.rolls[0]!, r.rolls[1]!));
  });
});
