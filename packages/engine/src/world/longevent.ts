import type { Calendar } from "../schema/authored.ts";
import type { ScheduleItem } from "../schema/authored.ts";
import type { EngineState } from "../state.ts";
import type { EventDraft, WorldTime } from "../types.ts";
import { fromMinutes, toMinutes } from "./calendar.ts";
import { currentPhaseIndex, phaseBoundaries } from "./schedule-parse.ts";

export function longEventPhaseDrafts(
  item: ScheduleItem,
  state: EngineState,
  from: WorldTime,
  to: WorldTime,
  calendar: Calendar,
): EventDraft[] {
  if (!item.phases?.length || !item.duration) return [];
  const st = state.schedule[item.id];
  if (!st?.startedAt || st.interrupted) return [];
  const startedAt = st.startedAt;
  const lastIndex = st.phaseIndex ?? -1;
  const bounds = phaseBoundaries(item.phases, startedAt, calendar);
  const fm = toMinutes(from, calendar);
  const tm = toMinutes(to, calendar);
  const out: EventDraft[] = [];
  for (const b of bounds) {
    const abs = toMinutes(b.at, calendar);
    if (abs <= fm || abs > tm) continue;
    if (b.index <= lastIndex) continue;
    out.push({
      kind: "longevent.phase",
      id: item.id,
      phase: b.phase,
      index: b.index,
      startedAt: { ...startedAt },
      t: { ...b.at },
      source: `schedule:${item.id}`,
    });
  }
  return out;
}

export function catchUpLongEventPhases(
  item: ScheduleItem,
  state: EngineState,
  at: WorldTime,
  calendar: Calendar,
): EventDraft[] {
  if (!item.phases?.length) return [];
  const st = state.schedule[item.id];
  if (!st?.startedAt || st.interrupted) return [];
  const idx = currentPhaseIndex(item.phases, st.startedAt, at, calendar);
  const lastIndex = st.phaseIndex ?? -1;
  if (idx <= lastIndex) return [];
  const bounds = phaseBoundaries(item.phases, st.startedAt, calendar);
  const out: EventDraft[] = [];
  for (const b of bounds) {
    if (b.index <= lastIndex || b.index > idx) continue;
    out.push({
      kind: "longevent.phase",
      id: item.id,
      phase: b.phase,
      index: b.index,
      startedAt: { ...st.startedAt },
      t: { ...b.at },
      source: `schedule:${item.id}`,
    });
  }
  return out;
}

export function longEventEnded(
  item: ScheduleItem,
  startedAt: WorldTime,
  at: WorldTime,
  calendar: Calendar,
): boolean {
  if (!item.duration) return false;
  return toMinutes(at, calendar) - toMinutes(startedAt, calendar) >= item.duration;
}
