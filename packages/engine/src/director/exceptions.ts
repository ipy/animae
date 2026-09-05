import type { ExceptionDef } from "../schema/authored.ts";
import type { Authored } from "../schema/authored.ts";
import type { WorldTime } from "../types.ts";
import { worldMinutes } from "../timeline/time.ts";

export function exceptionPeriodKey(period: ExceptionDef["period"], t: WorldTime, sessionId: string, authored: Authored): string {
  switch (period) {
    case "session":
      return sessionId;
    case "day":
      return `day:${t.day}`;
    case "chapter": {
      const chapters = authored.world.calendar.chapters;
      const m = worldMinutes(t);
      for (const ch of chapters) {
        const start = (ch.days[0] - 1) * 1440;
        const end = ch.days[1] * 1440 - 1;
        if (m >= start && m <= end) return `chapter:${ch.id}`;
      }
      return "chapter:none";
    }
    default:
      return sessionId;
  }
}
