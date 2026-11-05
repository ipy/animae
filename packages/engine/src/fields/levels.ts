import type { FieldEffects } from "../schema/authored.ts";

export const LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export type FieldLevel = (typeof LEVELS)[number];

export function levelIndex(level: string): number {
  const i = LEVELS.indexOf(level as FieldLevel);
  return i >= 0 ? i : 0;
}

export function emptyEffectsByLevel(): Record<FieldLevel, FieldEffects> {
  return { L0: {}, L1: {}, L2: {}, L3: {}, L4: {} };
}

/** Shallow-merge effect keys across levels (L0 → L4) for CEL and prompt consumption. */
export function mergeEffectsByLevel(byLevel: Record<FieldLevel, FieldEffects>): FieldEffects {
  const out: FieldEffects = {};
  for (const lvl of LEVELS) {
    const fx = byLevel[lvl];
    if (!fx) continue;
    for (const [key, val] of Object.entries(fx)) {
      if (val !== undefined) (out as Record<string, unknown>)[key] = val;
    }
  }
  return out;
}
