import type { Kernel } from "../contracts.ts";
import { decayTicks } from "../rules/decay.ts";
import type { EventDraft, WorldTime } from "../types.ts";
import { kernelRulesDeps } from "./rules-deps.ts";

/** Track decay for `(from, to]` via the rules module (`decayTicks`). */
export function decayTicksForSpan(k: Kernel, from: WorldTime, to: WorldTime): EventDraft[] {
  return decayTicks(kernelRulesDeps(k), from, to);
}
