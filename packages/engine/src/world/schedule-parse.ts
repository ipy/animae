import type { Calendar } from "../schema/authored.ts";
import type { ScheduleItem } from "../schema/authored.ts";
import type { WorldTime } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { dayMinutes, fromMinutes, toMinutes } from "./calendar.ts";
import { parseDurationMinutes } from "./duration.ts";

const AT_STRING = /^day (\d+)(?: (\d{1,2}):(\d{2}))?$/;

export function parseAtTime(at: ScheduleItem["at"], calendar: Calendar): WorldTime {
  if (!at) throw new AnimaeError("SCHEDULE_INVALID", "schedule item missing `at`");
  if (typeof at === "object") return { ...at };
  const m = at.match(AT_STRING);
  if (!m) throw new AnimaeError("SCHEDULE_INVALID", `invalid schedule at "${at}"`);
  const day = Number(m[1]);
  const hour = m[2] ? Number(m[2]) : 0;
  const minute = m[3] ? Number(m[3]) : 0;
  return { day, minute: hour * calendar.units.hour + minute };
}

/** Enumerate fire times in (from, to] for a schedule item (absolute minutes). */
export function fireTimesInRange(
  item: ScheduleItem,
  from: WorldTime,
  to: WorldTime,
  calendar: Calendar,
  offsetMinutes: number,
  lastFired: WorldTime | undefined,
  oneShotDone: boolean,
): number[] {
  const fm = toMinutes(from, calendar);
  const tm = toMinutes(to, calendar);
  if (tm <= fm) return [];

  if (item.at) {
    if (oneShotDone) return [];
    const at = parseAtTime(item.at, calendar);
    let abs = toMinutes(at, calendar) + offsetMinutes;
    if (abs <= fm) return [];
    if (abs > tm) return [];
    if (lastFired && toMinutes(lastFired, calendar) >= abs) return [];
    return [abs];
  }

  if (!item.every) return [];

  const every = item.every.trim();
  const times: number[] = [];

  if (every === "hour") {
    for (let m = fm + 1; m <= tm; m++) {
      if (m % calendar.units.hour !== 0) continue;
      if (lastFired && toMinutes(lastFired, calendar) >= m) continue;
      times.push(m);
    }
    return times;
  }

  const everyM = every.match(/^every (\d+)m$/);
  if (everyM) {
    const step = Number(everyM[1]);
    if (step <= 0) throw new AnimaeError("SCHEDULE_INVALID", `invalid every interval "${every}"`);
    let m = fm + 1;
    const align = m - (m % step);
    if (align > fm) m = align;
    else m = align + step;
    for (; m <= tm; m += step) {
      if (lastFired && toMinutes(lastFired, calendar) >= m) continue;
      times.push(m);
    }
    return times;
  }

  const daily = every.match(/^day (\d{1,2}):(\d{2})$/);
  if (daily) {
    const minuteOfDay = Number(daily[1]) * calendar.units.hour + Number(daily[2]);
    const dm = dayMinutes(calendar);
    const startDay = Math.floor(fm / dm) + 1;
    const endDay = Math.floor(tm / dm) + 1;
    for (let d = startDay; d <= endDay; d++) {
      const abs = (d - 1) * dm + minuteOfDay + offsetMinutes;
      if (abs <= fm || abs > tm) continue;
      if (lastFired && toMinutes(lastFired, calendar) >= abs) continue;
      times.push(abs);
    }
    return times;
  }

  const weekly = every.match(/^week (\d) (\d{1,2}):(\d{2})$/);
  if (weekly) {
    const weekdayIndex = Number(weekly[1]);
    const minuteOfDay = Number(weekly[2]) * calendar.units.hour + Number(weekly[3]);
    const dm = dayMinutes(calendar);
    const weekdays = calendar.weekdays?.length ?? 7;
    const startDay = Math.floor(fm / dm) + 1;
    const endDay = Math.floor(tm / dm) + 1;
    for (let d = startDay; d <= endDay; d++) {
      if ((d - 1) % weekdays !== weekdayIndex) continue;
      const abs = (d - 1) * dm + minuteOfDay + offsetMinutes;
      if (abs <= fm || abs > tm) continue;
      if (lastFired && toMinutes(lastFired, calendar) >= abs) continue;
      times.push(abs);
    }
    return times;
  }

  throw new AnimaeError("SCHEDULE_INVALID", `unsupported schedule every "${every}"`);
}

export function parseScheduleDuration(item: ScheduleItem, calendar: Calendar): number | undefined {
  if (item.duration == null) return undefined;
  return item.duration;
}

export function phaseBoundaries(
  phases: { id: string; minutes: number }[],
  startedAt: WorldTime,
  calendar: Calendar,
): { index: number; phase: string; at: WorldTime }[] {
  let elapsed = 0;
  const out: { index: number; phase: string; at: WorldTime }[] = [];
  const startM = toMinutes(startedAt, calendar);
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]!;
    out.push({ index: i, phase: p.id, at: fromMinutes(startM + elapsed, calendar) });
    elapsed += p.minutes;
  }
  return out;
}

export function currentPhaseIndex(
  phases: { id: string; minutes: number }[],
  startedAt: WorldTime,
  at: WorldTime,
  calendar: Calendar,
): number {
  const elapsed = toMinutes(at, calendar) - toMinutes(startedAt, calendar);
  if (elapsed < 0) return -1;
  let acc = 0;
  for (let i = 0; i < phases.length; i++) {
    acc += phases[i]!.minutes;
    if (elapsed < acc) return i;
  }
  return phases.length - 1;
}

export function parseEveryIntervalMinutes(every: string, calendar: Calendar): number | undefined {
  if (every === "hour") return calendar.units.hour;
  const m = every.match(/^every (\d+)m$/);
  if (m) return Number(m[1]);
  return undefined;
}
