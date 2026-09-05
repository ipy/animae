import type { CueRenderer } from "../types.ts";
import { builtinCueRenderers } from "./builtins.tsx";

export function createCueRegistry(
  extra?: Record<string, CueRenderer>,
): Map<string, CueRenderer> {
  const map = new Map<string, CueRenderer>(Object.entries(builtinCueRenderers));
  if (extra) {
    for (const [k, v] of Object.entries(extra)) map.set(k, v);
  }
  return map;
}

export function cueVisibleAt(at: number, visibleChars: number): boolean {
  return visibleChars > at;
}
