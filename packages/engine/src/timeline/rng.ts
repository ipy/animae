import { createHash } from "node:crypto";
import type { Rng } from "../types.ts";

/** Mulberry32 PRNG seeded from a 32-bit integer. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromKey(seed: number, rootBranch: string, key: string): number {
  const hex = createHash("sha256").update(`${seed}:${rootBranch}:${key}`).digest("hex");
  return Number.parseInt(hex.slice(0, 8), 16);
}

export function createRng(seed: number, rootBranch: string, key: string): Rng {
  const next = mulberry32(seedFromKey(seed, rootBranch, key));
  return {
    next,
    int(min, max) {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick(xs) {
      if (xs.length === 0) throw new Error("rng.pick: empty array");
      return xs[Math.floor(next() * xs.length)]!;
    },
  };
}
