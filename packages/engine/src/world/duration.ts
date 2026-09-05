import type { Duration } from "../types.ts";
import { AnimaeError } from "../types.ts";

const DURATION_RE = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/;

export function parseDurationMinutes(d: Duration, dayLen = 1440, hourLen = 60): number {
  if (typeof d === "number") {
    if (!Number.isFinite(d) || d < 0) throw new AnimaeError("INVALID_DURATION", "duration must be a non-negative number of minutes");
    return d;
  }
  if (typeof d === "object" && d !== null) {
    const days = d.days ?? 0;
    const hours = d.hours ?? 0;
    const minutes = d.minutes ?? 0;
    if (days < 0 || hours < 0 || minutes < 0) throw new AnimaeError("INVALID_DURATION", "duration object fields must be non-negative");
    return days * dayLen + hours * hourLen + minutes;
  }
  if (typeof d !== "string") throw new AnimaeError("INVALID_DURATION", "unsupported duration type");
  const s = d.trim();
  if (!s) throw new AnimaeError("INVALID_DURATION", "empty duration string");
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n < 0) throw new AnimaeError("INVALID_DURATION", "duration must be non-negative");
    return n;
  }
  const m = s.match(DURATION_RE);
  if (!m || m[0] !== s) throw new AnimaeError("INVALID_DURATION", `malformed duration "${d}"`);
  const days = m[1] ? Number(m[1]) : 0;
  const hours = m[2] ? Number(m[2]) : 0;
  const minutes = m[3] ? Number(m[3]) : 0;
  if (days + hours + minutes === 0 && !/[dhm]/.test(s)) {
    throw new AnimaeError("INVALID_DURATION", `malformed duration "${d}"`);
  }
  return days * dayLen + hours * hourLen + minutes;
}
