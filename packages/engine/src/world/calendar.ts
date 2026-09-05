import type { Calendar } from "../schema/authored.ts";
import type { WorldTime } from "../types.ts";

export function dayMinutes(calendar: Calendar): number {
  return calendar.units.day;
}

export function toMinutes(t: WorldTime, calendar: Calendar): number {
  return (t.day - 1) * dayMinutes(calendar) + t.minute;
}

export function fromMinutes(m: number, calendar: Calendar): WorldTime {
  const dm = dayMinutes(calendar);
  if (!Number.isFinite(m) || m < 0) {
    throw new RangeError("minutes must be a non-negative finite number");
  }
  const day = Math.floor(m / dm) + 1;
  const minute = m - (day - 1) * dm;
  return { day, minute };
}

export function compareTime(a: WorldTime, b: WorldTime, calendar: Calendar): number {
  return toMinutes(a, calendar) - toMinutes(b, calendar);
}

export function formatTime(
  t: WorldTime,
  calendar: Calendar,
): { day: number; hour: number; minute: number; hhmm: string; weekday?: string } {
  const dm = dayMinutes(calendar);
  const hour = Math.floor(t.minute / calendar.units.hour);
  const minute = t.minute % calendar.units.hour;
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const weekdays = calendar.weekdays;
  const weekday = weekdays?.length ? weekdays[(t.day - 1) % weekdays.length] : undefined;
  return { day: t.day, hour, minute, hhmm: `${hh}:${mm}`, weekday };
}

export function chapterAt(
  t: WorldTime,
  calendar: Calendar,
): { id: string; title?: string } | undefined {
  for (const ch of calendar.chapters) {
    const [from, to] = ch.days;
    if (t.day >= from && t.day <= to) return { id: ch.id, title: ch.title };
  }
  return undefined;
}

/** Absolute minutes at start of `day` (day 1 → 0). */
export function startOfDay(day: number, calendar: Calendar): number {
  return (day - 1) * dayMinutes(calendar);
}

/** List day-boundary absolute minutes crossed in (from, to] (start of each new day). */
export function dayBoundariesCrossed(from: WorldTime, to: WorldTime, calendar: Calendar): number[] {
  const fm = toMinutes(from, calendar);
  const tm = toMinutes(to, calendar);
  if (tm <= fm) return [];
  const dm = dayMinutes(calendar);
  const out: number[] = [];
  const firstDay = Math.floor(fm / dm) + 1;
  const lastDay = Math.floor(tm / dm) + 1;
  for (let d = firstDay + 1; d <= lastDay; d++) {
    const boundary = startOfDay(d, calendar);
    if (boundary > fm && boundary <= tm) out.push(boundary);
  }
  return out;
}
