import type { Rng } from "../types.ts";
import { AnimaeError } from "../types.ts";

const MAX_DICE = 100;
const MAX_SIDES = 1000;

export interface DiceRollResult {
  expr: string;
  rolls: number[];
  kept: number[];
  modifier: number;
  total: number;
}

export interface CheckInput {
  expr: string;
  dc: number;
  rng: Rng;
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface CheckResult extends DiceRollResult {
  dc: number;
  success: boolean;
  margin: number;
}

const DICE_RE = /^(\d+)d(\d+)(?:(kh|kl)(\d+))?([+-]\d+)?$/i;

export function parseDice(expr: string): { n: number; m: number; keep?: "kh" | "kl"; keepN?: number; modifier: number } {
  const s = expr.replace(/\s+/g, "");
  const m = s.match(DICE_RE);
  if (!m) throw new AnimaeError("DICE_INVALID", `malformed dice expression "${expr}"`);
  const n = Number(m[1]);
  const sides = Number(m[2]);
  if (n < 1 || n > MAX_DICE) throw new AnimaeError("DICE_INVALID", `dice count ${n} out of range 1..${MAX_DICE}`);
  if (sides < 1 || sides > MAX_SIDES) throw new AnimaeError("DICE_INVALID", `die size ${sides} out of range 1..${MAX_SIDES}`);
  const keepOp = m[3]?.toLowerCase() as "kh" | "kl" | undefined;
  const keepN = m[4] ? Number(m[4]) : undefined;
  const modifier = m[5] ? Number(m[5]) : 0;
  if (keepOp && (keepN === undefined || keepN < 1 || keepN > n)) {
    throw new AnimaeError("DICE_INVALID", `keep count invalid in "${expr}"`);
  }
  return { n, m: sides, keep: keepOp, keepN, modifier };
}

function rollOnce(n: number, m: number, rng: Rng): number[] {
  const rolls: number[] = [];
  for (let i = 0; i < n; i++) rolls.push(rng.int(1, m));
  return rolls;
}

function applyKeep(rolls: number[], keep: "kh" | "kl", keepN: number): number[] {
  const sorted = [...rolls].sort((a, b) => a - b);
  if (keep === "kh") return sorted.slice(-keepN);
  return sorted.slice(0, keepN);
}

export function rollDice(
  expr: string,
  rng: Rng,
  opts?: { advantage?: boolean; disadvantage?: boolean },
): DiceRollResult {
  const { n, m, keep, keepN, modifier } = parseDice(expr);
  let rolls = rollOnce(n, m, rng);
  let kept = rolls;

  const adv = opts?.advantage && !opts?.disadvantage;
  const dis = opts?.disadvantage && !opts?.advantage;

  if (m === 20 && n === 1 && (adv || dis)) {
    const r2 = rollOnce(1, 20, rng)[0]!;
    rolls = [rolls[0]!, r2];
    const r1 = rolls[0] ?? 1;
    kept = [adv ? Math.max(r1, r2) : Math.min(r1, r2)];
  } else if (keep && keepN) {
    kept = applyKeep(rolls, keep, keepN);
  }

  const sum = kept.reduce((a, b) => a + b, 0);
  return { expr, rolls, kept, modifier, total: sum + modifier };
}

export function check(input: CheckInput): CheckResult {
  const rolled = rollDice(input.expr, input.rng, {
    advantage: input.advantage,
    disadvantage: input.disadvantage,
  });
  const success = rolled.total >= input.dc;
  return {
    ...rolled,
    dc: input.dc,
    success,
    margin: rolled.total - input.dc,
  };
}
