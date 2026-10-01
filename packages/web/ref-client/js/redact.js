/** @typedef {Record<string, unknown> | unknown[] | unknown} JsonValue */

const SECRET_KEY_RE = /(?:^|[._-])(token|apikey|api_key|secret|password|authorization|auth)(?:$|[._-])|token|secret|password|apikey|authorization/i;

/**
 * @param {string} key
 */
export function looksLikeSecretKey(key) {
  return SECRET_KEY_RE.test(key);
}

/**
 * @param {unknown} value
 */
export function isMaskedSecretValue(value) {
  if (value == null) return true;
  if (typeof value !== "string") return true;
  const t = value.trim();
  if (t.length === 0) return true;
  if (t.includes("•") || t.includes("●")) return true;
  if (/^\*+$/.test(t)) return true;
  if (/^x{3,}$/i.test(t)) return true;
  return false;
}

/**
 * @param {Record<string, unknown>} config
 * @returns {string[]} offending key paths
 */
export function findLeakedSecretKeys(config, prefix = "") {
  /** @type {string[]} */
  const bad = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) return bad;
  for (const [k, v] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (looksLikeSecretKey(k) && !isMaskedSecretValue(v)) {
      bad.push(path);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      bad.push(...findLeakedSecretKeys(/** @type {Record<string, unknown>} */ (v), path));
    }
  }
  return bad;
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @returns {unknown}
 */
export function redactValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/\bsk-[A-Za-z0-9_-]{8,}\b/.test(value)) return "[redacted]";
    if (/\bBearer\s+[A-Za-z0-9._-]{8,}\b/i.test(value)) return "[redacted]";
    return value;
  }
  if (typeof value !== "object") return value;
  if (depth > 12) return "[…]";
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    if (looksLikeSecretKey(k) && typeof v === "string" && v.length > 0) {
      out[k] = "[redacted]";
    } else {
      out[k] = redactValue(v, depth + 1);
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>} frame
 */
export function summarizeFrame(frame) {
  const type = typeof frame.type === "string" ? frame.type : "?";
  const seq = typeof frame.seq === "number" ? frame.seq : null;
  const raw = JSON.stringify(redactValue(frame));
  return {
    type,
    seq,
    size: raw.length,
    summary: type,
  };
}
