/**
 * @param {{ seq: number, slot: string, label: string, status: string, request?: { segments?: { role: string, text: string }[] }, response?: { usage?: Record<string, number> } }[]} entries
 * @param {{ slot?: string, label?: string, errorsOnly?: boolean }} filters
 */
export function filterLlmEntries(entries, filters) {
  let rows = [...entries];
  const label = (filters.label ?? "").trim().toLowerCase();
  if (label) rows = rows.filter((e) => e.label.toLowerCase().includes(label));
  if (filters.slot) rows = rows.filter((e) => e.slot === filters.slot);
  if (filters.errorsOnly) rows = rows.filter((e) => e.status !== "ok");
  return rows.sort((a, b) => b.seq - a.seq);
}

/**
 * @param {unknown[]} entries
 */
export function entriesToJsonl(entries) {
  return entries.map((e) => JSON.stringify(e)).join("\n");
}

/**
 * @param {{ request?: { segments?: { role: string, text: string }[] } }} entry
 */
export function promptText(entry) {
  const segs = entry.request?.segments ?? [];
  return segs.map((s) => `[${s.role}]\n${s.text}`).join("\n\n");
}

/**
 * @param {{ response?: { usage?: Record<string, number> } }} entry
 */
export function formatTokens(entry) {
  const u = entry.response?.usage;
  if (!u) return "—";
  const inp = u.inputTokens ?? u.promptTokens ?? "—";
  const out = u.outputTokens ?? u.completionTokens ?? "—";
  return `${inp} / ${out}`;
}

/**
 * Merge log batches by seq (newer entries win on collision).
 * @param {unknown[]} existing
 * @param {unknown[]} batch
 */
export function mergeLlmEntriesBySeq(existing, batch) {
  const map = new Map();
  for (const e of existing) {
    const seq = /** @type {{ seq?: number }} */ (e).seq;
    if (typeof seq === "number") map.set(seq, e);
  }
  for (const e of batch) {
    const seq = /** @type {{ seq?: number }} */ (e).seq;
    if (typeof seq === "number") map.set(seq, e);
  }
  return [...map.values()].sort(
    (a, b) => /** @type {{ seq: number }} */ (b).seq - /** @type {{ seq: number }} */ (a).seq,
  );
}

/**
 * Fetch all pages from a host that returns at most `pageSize` entries per llm_log response.
 * @param {(since?: number) => Promise<{ enabled: boolean, entries: unknown[], newestSeq: number }>} fetchPage
 * @param {number} [pageSize]
 */
export async function fetchAllLlmLogEntries(fetchPage, pageSize = 50) {
  /** @type {unknown[]} */
  let all = [];
  let since = undefined;
  let enabled = true;
  let newestSeq = 0;
  for (let guard = 0; guard < 500; guard++) {
    const page = await fetchPage(since);
    enabled = page.enabled;
    newestSeq = page.newestSeq;
    if (!page.enabled) break;
    all = mergeLlmEntriesBySeq(all, page.entries);
    if (page.entries.length < pageSize) break;
    since = newestSeq;
    if (page.entries.length === 0) break;
  }
  return { enabled, entries: all, newestSeq };
}
