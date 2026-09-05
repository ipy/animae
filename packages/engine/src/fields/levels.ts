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
