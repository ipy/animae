import type { Kernel } from "../contracts.ts";
import { worldMinutes } from "../timeline/time.ts";
import { anchorDeadlineMinutes, scenesUntilDeadline } from "./anchors.ts";

/** Absolute minutes in `(fromM, toM]` where anchor / beat director work may transition during a time jump. */
export function collectTimeAdvancedCheckpoints(k: Kernel, fromM: number, toM: number): number[] {
  if (toM <= fromM) return [];

  const sceneMinutes = k.authored.world.calendar.sceneMinutes;
  const turnMinutes = k.authored.world.calendar.turnMinutes;
  const ctx = k.celContext({ extra: { time: k.timeline.now() } });
  const toMin = (t: { day: number; minute: number }) => worldMinutes(t);
  const mins = new Set<number>();

  for (const anchor of k.authored.anchors) {
    const strategies = anchor.strategies;
    const deadline = anchorDeadlineMinutes(anchor, k.rules.cel, ctx, toMin);
    if (deadline === undefined) continue;

    if (strategies.includes("soft")) {
      const softEnter = deadline - sceneMinutes + 1;
      if (softEnter > fromM && softEnter <= toM) mins.add(softEnter);
      const scenesLeftAtFrom = scenesUntilDeadline(deadline, fromM, sceneMinutes);
      if (scenesLeftAtFrom > 0 && scenesLeftAtFrom < 1 && fromM < deadline) {
        const immediate = fromM + 1;
        if (immediate <= toM && immediate < deadline) mins.add(immediate);
      }
    }

    if (strategies.includes("force")) {
      const forceEnter = deadline - sceneMinutes - turnMinutes + 1;
      if (forceEnter > fromM && forceEnter <= toM) mins.add(forceEnter);
    }

    if (strategies.includes("hard") && deadline > fromM && deadline <= toM) {
      mins.add(deadline);
    }
  }

  if (k.authored.beats.length > 0) {
    for (let m = Math.floor(fromM / sceneMinutes) * sceneMinutes + sceneMinutes; m <= toM; m += sceneMinutes) {
      if (m > fromM) mins.add(m);
    }
  }

  return [...mins].sort((a, b) => a - b);
}
