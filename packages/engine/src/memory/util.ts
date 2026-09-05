import type { WorldTime } from "../types.ts";
import { worldMinutes } from "../timeline/time.ts";

export function ageWorldDays(from: WorldTime, now: WorldTime): number {
  return Math.max(0, (worldMinutes(now) - worldMinutes(from)) / 1440);
}

export function memoryJsonlPath(owner: string): string {
  return `${owner}/memory.jsonl`;
}

export function summaryMdPath(owner: string, id: string): string {
  return `${owner}/summaries/${id}.md`;
}

export function forgettingRetention(ageDays: number, importance: number, tau: number): number {
  return Math.exp(-ageDays / (tau * (0.5 + importance)));
}

export function deepCopy<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return structuredClone(value);
}
