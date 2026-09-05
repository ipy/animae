import type { WorldTime } from "../types.ts";

export function worldMinutes(t: WorldTime): number {
  return (t.day - 1) * 1440 + t.minute;
}

export function hoursBetween(a: WorldTime, b: WorldTime): number {
  return Math.abs(worldMinutes(b) - worldMinutes(a)) / 60;
}
