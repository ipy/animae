import type { Kernel, RuleCtx } from "../contracts.ts";
import type { ScheduleItem } from "../schema/authored.ts";
import type { EventDraft, WorldTime } from "../types.ts";
import { compareTime, fromMinutes, toMinutes } from "./calendar.ts";
import { catchUpLongEventPhases, longEventPhaseDrafts } from "./longevent.ts";
// catchUpLongEventPhases used in longEventPhaseDraftsInRange
import { activeScheduleOffsets } from "./schedule-offset.ts";
import { fireTimesInRange, parseAtTime } from "./schedule-parse.ts";

export interface ScheduledFire {
  absMinutes: number;
  item: ScheduleItem;
  at: WorldTime;
}

export function collectScheduledFires(
  k: Kernel,
  from: WorldTime,
  to: WorldTime,
): ScheduledFire[] {
  const calendar = k.authored.world.calendar;
  const state = k.timeline.state();
  const offsets = activeScheduleOffsets(state);
  const fires: ScheduledFire[] = [];

  for (const item of k.authored.schedule) {
    const st = state.schedule[item.id];
    const oneShotDone = Boolean(item.at && st?.done);
    const lastFired = st?.lastFired;
    const offset = offsets[item.id] ?? 0;
    const times = fireTimesInRange(item, from, to, calendar, offset, lastFired, oneShotDone);
    for (const abs of times) {
      fires.push({ absMinutes: abs, item, at: fromMinutes(abs, calendar) });
    }
  }

  fires.sort((a, b) => a.absMinutes - b.absMinutes);
  return fires;
}

export function draftsForScheduleFire(k: Kernel, fire: ScheduledFire): EventDraft[] {
  const { item, at } = fire;

  if (item.when) {
    const ctx = k.celContext({ extra: { time: at, schedule: { id: item.id } } });
    if (!k.rules.cel.bool(item.when, ctx)) return [];
  }

  const out: EventDraft[] = [];
  out.push({
    kind: "schedule.fired",
    id: item.id,
    at: { ...at },
    t: { ...at },
    source: `schedule:${item.id}`,
  });

  if (item.phases?.length && item.duration) {
    out.push({
      kind: "longevent.phase",
      id: item.id,
      phase: item.phases[0]!.id,
      index: 0,
      startedAt: { ...at },
      t: { ...at },
      source: `schedule:${item.id}`,
    });
  }

  const emitted = resolveEmitDrafts(k, item, at);
  for (const d of emitted) {
    out.push({ ...d, t: d.t ?? { ...at }, source: d.source ?? `schedule:${item.id}` });
  }

  return out;
}

function resolveEmitDrafts(k: Kernel, item: ScheduleItem, at: WorldTime): EventDraft[] {
  if (item.emit) {
    const raw = Array.isArray(item.emit) ? item.emit : [item.emit];
    return raw.map((d) => ({ ...d }));
  }
  if (item.rule) {
    const fn = k.rules.fn(item.rule);
    if (!fn) {
      k.warn("RULE_MISSING", `schedule item ${item.id} references unknown rule "${item.rule}"`);
      return [];
    }
    const ctx: RuleCtx = {
      stage: "tick",
      state: k.timeline.state(),
      authored: k.authored,
      policy: k.policy,
      time: at,
      vars: k.celContext({ extra: { time: at, schedule: { id: item.id } } }),
      rng: () => k.timeline.rng(`schedule:${item.id}:${at.day}:${at.minute}`).next(),
    };
    return fn(ctx);
  }
  return [];
}

export function longEventPhaseDraftsInRange(k: Kernel, from: WorldTime, to: WorldTime): EventDraft[] {
  const calendar = k.authored.world.calendar;
  const state = k.timeline.state();
  const out: EventDraft[] = [];
  for (const item of k.authored.schedule) {
    if (!item.phases?.length) continue;
    out.push(...longEventPhaseDrafts(item, state, from, to, calendar));
    out.push(...catchUpLongEventPhases(item, state, to, calendar));
  }
  return out;
}

export function compareWorldTime(a: WorldTime, b: WorldTime, k: Kernel): number {
  return compareTime(a, b, k.authored.world.calendar);
}
