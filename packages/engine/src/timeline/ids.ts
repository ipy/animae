import type { EventId } from "../types.ts";

export function formatEventId(seq: number): EventId {
  return `evt_${String(seq).padStart(4, "0")}`;
}

export function parseEventSeq(id: EventId): number {
  const m = /^evt_(\d+)$/.exec(id);
  if (!m) throw new Error(`Invalid event id: ${id}`);
  return Number.parseInt(m[1]!, 10);
}

export function nextBranchName(existing: string[]): string {
  let n = 1;
  while (existing.includes(`b${n}`)) n++;
  return `b${n}`;
}
