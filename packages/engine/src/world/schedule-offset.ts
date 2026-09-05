import type { EngineState } from "../state.ts";

/** Sum L0 `schedule_offset` minutes from active runtime fields (world module consumes this effect). */
export function activeScheduleOffsets(state: EngineState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const af of Object.values(state.fields)) {
    if (af.def.level !== "L0") continue;
    const off = af.def.effects.schedule_offset;
    if (!off) continue;
    for (const [id, min] of Object.entries(off)) {
      out[id] = (out[id] ?? 0) + min;
    }
  }
  return out;
}
