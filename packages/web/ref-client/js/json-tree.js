/**
 * @param {unknown} value
 * @param {string} [label]
 * @returns {{ html: string, plain: string }}
 */
export function buildJsonTree(value, label = "root") {
  /** @type {string[]} */
  const plainParts = [];
  const html = renderNode(value, label, 0, plainParts);
  return { html, plain: plainParts.join("\n") };
}

/**
 * @param {unknown} value
 * @param {string} query
 */
export function jsonTreeMatches(value, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  try {
    const blob = JSON.stringify(value).toLowerCase();
    return blob.includes(q);
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @param {string} key
 * @param {number} depth
 * @param {string[]} plainParts
 */
function renderNode(value, key, depth, plainParts) {
  const pad = depth;
  if (value === null) {
    plainParts.push(`${"  ".repeat(pad)}${key}: null`);
    return `<div class="jt-node" data-depth="${depth}"><span class="jt-key">${esc(key)}</span>: <span class="jt-null">null</span></div>`;
  }
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    plainParts.push(`${"  ".repeat(pad)}${key}: ${JSON.stringify(value)}`);
    return `<div class="jt-node" data-depth="${depth}"><span class="jt-key">${esc(key)}</span>: <span class="jt-prim jt-${t}">${esc(String(value))}</span></div>`;
  }
  if (Array.isArray(value)) {
    plainParts.push(`${"  ".repeat(pad)}${key}: [`);
    const id = `jt-${Math.random().toString(36).slice(2, 9)}`;
    const inner = value
      .map((v, i) => renderNode(v, String(i), depth + 1, plainParts))
      .join("");
    plainParts.push(`${"  ".repeat(pad)}]`);
    return `<details class="jt-branch" open data-depth="${depth}"><summary><span class="jt-key">${esc(key)}</span> <span class="jt-meta">[${value.length}]</span></summary><div class="jt-children">${inner}</div></details>`;
  }
  if (t === "object") {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value));
    plainParts.push(`${"  ".repeat(pad)}${key}: {`);
    const inner = entries.map(([k, v]) => renderNode(v, k, depth + 1, plainParts)).join("");
    plainParts.push(`${"  ".repeat(pad)}}`);
    return `<details class="jt-branch" open data-depth="${depth}"><summary><span class="jt-key">${esc(key)}</span> <span class="jt-meta">{${entries.length}}</span></summary><div class="jt-children">${inner}</div></details>`;
  }
  plainParts.push(`${"  ".repeat(pad)}${key}: ${String(value)}`);
  return `<div class="jt-node"><span class="jt-key">${esc(key)}</span>: ${esc(String(value))}</div>`;
}

/**
 * @param {string} s
 */
function esc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
