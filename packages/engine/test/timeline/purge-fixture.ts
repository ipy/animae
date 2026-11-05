import type { EngineEvent } from "../../src/types.ts";

/** Minimal event fields shared by synthetic purge scenarios. */
export function purgeEventBase(sid = "sess-main"): Pick<EngineEvent, "t" | "sid" | "source" | "because"> {
  return { t: { day: 1, minute: 480 }, sid, source: "test", because: [] };
}
