import { redactValue, summarizeFrame } from "./redact.js";

/**
 * @param {Record<string, unknown>[]} buffer
 * @param {Record<string, unknown>} frame
 * @param {'in'|'out'} direction
 * @param {number} max
 */
export function pushProtocolFrame(buffer, frame, direction, max = 500) {
  const redacted = /** @type {Record<string, unknown>} */ (redactValue(frame));
  const sum = summarizeFrame(frame);
  const entry = {
    direction,
    type: sum.type,
    seq: sum.seq,
    size: sum.size,
    at: Date.now(),
    body: redacted,
  };
  buffer.push(entry);
  while (buffer.length > max) buffer.shift();
  return entry;
}

/**
 * @param {Record<string, unknown>[]} buffer
 * @param {string | null} typeFilter
 */
export function filterProtocolFeed(buffer, typeFilter) {
  if (!typeFilter) return buffer;
  return buffer.filter((e) => e.type === typeFilter);
}
