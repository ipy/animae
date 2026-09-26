/**
 * Item-level form of a list-like section (knowledge documents, recalled memories). When the whole section does not
 * fit, items are kept in order (most important first) for as long as they fit, so a long list degrades to a shorter
 * one instead of disappearing together with the guidance it carries.
 */
export interface BudgetItems {
  /** Items, most important first. */
  list: string[];
  /** Builds the section text from the kept items (heading, separators). `compose(list)` must equal the section `text`. */
  compose: (kept: string[]) => string;
}

export interface BudgetSection {
  /** Stable id for diagnostics when dropped. */
  id: string;
  /** Higher priority sections are kept first when over budget. */
  priority: number;
  text: string;
  /** Optional graceful-degradation form; sections without it are kept or dropped whole. */
  items?: BudgetItems;
}

const PARA_BREAK = /\n\n+/;

/** Sentence terminators for Latin and CJK full-width punctuation, written as escapes so sources stay free of CJK literals. */
const SENTENCE_END = [".", "!", "?", "\u3002", "\uff01", "\uff1f"];

/** Trim at last paragraph or sentence boundary within maxLen. Never appends a truncation marker. */
export function trimAtBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  if (maxLen <= 0) return "";
  const slice = text.slice(0, maxLen);
  const para = slice.lastIndexOf("\n\n");
  if (para >= Math.floor(maxLen * 0.5)) return slice.slice(0, para).trimEnd();
  const sentence = Math.max(
    ...SENTENCE_END.map((mark) => slice.lastIndexOf(mark)),
  );
  if (sentence >= Math.floor(maxLen * 0.45)) return slice.slice(0, sentence + 1).trimEnd();
  return slice.trimEnd();
}

/** Keep items in order while the composed section fits `room`; `null` when not even one item fits. */
function fitItems(items: BudgetItems, room: number): { text: string; omitted: number } | null {
  const kept: string[] = [];
  let omitted = 0;
  for (const item of items.list) {
    if (items.compose([...kept, item]).length <= room) kept.push(item);
    else omitted++;
  }
  return kept.length ? { text: items.compose(kept), omitted } : null;
}

/**
 * Concatenate ordered sections (highest priority first). Over budget, list-like sections keep as many of their most
 * important items as fit and other low-priority sections are dropped whole (ids are reported in `dropped`; a partially
 * kept section is reported as `<id>[<n> omitted]`). As a last resort the lowest kept section is trimmed on a
 * paragraph/sentence boundary.
 */
export function assembleBudgetSections(
  sections: BudgetSection[],
  maxChars: number | undefined,
): { text: string; dropped: string[] } {
  const ordered = [...sections]
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  if (!maxChars) {
    return { text: ordered.map((s) => s.text).join("\n\n"), dropped: [] };
  }

  const kept: BudgetSection[] = [];
  const dropped: string[] = [];
  let used = 0;

  for (const s of ordered) {
    const sep = kept.length ? 2 : 0;
    if (used + sep + s.text.length <= maxChars) {
      kept.push(s);
      used += sep + s.text.length;
      continue;
    }
    const fitted = s.items ? fitItems(s.items, maxChars - used - sep) : null;
    if (fitted) {
      kept.push({ ...s, text: fitted.text });
      used += sep + fitted.text.length;
      dropped.push(`${s.id}[${fitted.omitted} omitted]`);
      continue;
    }
    dropped.push(s.id);
  }

  if (kept.length === 0 && ordered.length > 0) {
    const lowest = ordered[ordered.length - 1]!;
    kept.push({ ...lowest, text: trimAtBoundary(lowest.text, maxChars) });
    for (const s of ordered.slice(0, -1)) dropped.push(s.id);
  } else if (kept.length > 0 && used > maxChars) {
    const last = kept[kept.length - 1]!;
    const priorLen = kept.slice(0, -1).reduce((n, x, i) => n + x.text.length + (i ? 2 : 0), 0);
    const room = maxChars - priorLen - (priorLen ? 2 : 0);
    last.text = trimAtBoundary(last.text, Math.max(0, room));
  } else if (kept.length > 0) {
    const priorLen = kept.slice(0, -1).reduce((n, x, i) => n + x.text.length + (i ? 2 : 0), 0);
    const room = maxChars - priorLen - (priorLen ? 2 : 0);
    const last = kept[kept.length - 1]!;
    if (last.text.length > room) {
      last.text = trimAtBoundary(last.text, Math.max(0, room));
    }
  }

  return { text: kept.map((s) => s.text).join("\n\n"), dropped };
}

/** Drop trailing blank lines; collapse 3+ newlines to 2. */
export function normalizePromptWhitespace(text: string): string {
  return text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
