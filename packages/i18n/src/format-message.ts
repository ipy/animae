import type { FormatParams, JsonValue } from "./types.ts";

type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

function pluralCategory(locale: string, n: number, type: "cardinal" | "ordinal"): PluralCategory {
  try {
    const pr = new Intl.PluralRules(locale, { type });
    return pr.select(n) as PluralCategory;
  } catch {
    return n === 1 ? "one" : "other";
  }
}

function formatNumber(locale: string, value: number, style?: string): string {
  if (style === "currency" && typeof value === "number") {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(value);
  }
  if (style === "percent") return new Intl.NumberFormat(locale, { style: "percent" }).format(value);
  return new Intl.NumberFormat(locale).format(value);
}

function formatDate(locale: string, value: unknown, style?: string): string {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  if (style === "time") return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(d);
  if (style === "datetime") return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
}

function formatRelativeTime(locale: string, value: number, unit: Intl.RelativeTimeFormatUnit): string {
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit);
  } catch {
    return `${value} ${unit}`;
  }
}

/** ICU MessageFormat subset: `{name}`, `{n, number}`, `{d, date}`, plural/select/selectordinal blocks. */
export function formatMessage(locale: string, pattern: string, params: FormatParams = {}): string {
  let i = 0;
  const len = pattern.length;

  function parseBlock(endChar: string): string {
    let depth = 1;
    const start = i;
    while (i < len && depth > 0) {
      if (pattern[i] === "{") depth++;
      else if (pattern[i] === "}") depth--;
      i++;
    }
    const inner = pattern.slice(start, i - 1);
    return inner;
  }

  function resolvePlural(inner: string, varName: string, n: number, ordinal: boolean): string {
    const type = ordinal ? "ordinal" : "cardinal";
    const cat = pluralCategory(locale, n, type);
    const options = inner.split(/\s+(?=\w+\s*\{)/).filter(Boolean);
    for (const opt of options) {
      const m = /^(\w+)\s*\{(.*)\}$/s.exec(opt.trim());
      if (!m) continue;
      const [, key, body] = m;
      if (key === "=0" && n === 0) return formatMessage(locale, body!, { ...params, [varName]: n });
      if (key === cat || (key === "other" && cat === "other")) return formatMessage(locale, body!, { ...params, [varName]: n });
    }
    const other = options.find((o) => o.startsWith("other "));
    if (other) {
      const body = other.replace(/^other\s*/, "");
      return formatMessage(locale, body, { ...params, [varName]: n });
    }
    return String(n);
  }

  function resolveSelect(inner: string, varName: string, sel: string): string {
    const options = inner.split(/\s+(?=\w+\s*\{)/).filter(Boolean);
    for (const opt of options) {
      const m = /^(\w+)\s*\{(.*)\}$/s.exec(opt.trim());
      if (!m) continue;
      const [, key, body] = m;
      if (key === sel || (key === "other" && !options.some((o) => o.startsWith(`${sel} `)))) {
        return formatMessage(locale, body!, params);
      }
    }
    return sel;
  }

  let out = "";
  while (i < len) {
    if (pattern[i] !== "{") {
      out += pattern[i];
      i++;
      continue;
    }
    i++;
    if (pattern[i] === "{") {
      out += "{";
      i++;
      continue;
    }
    const start = i;
    while (i < len && pattern[i] !== "}" && pattern[i] !== ",") i++;
    const name = pattern.slice(start, i).trim();
    if (i < len && pattern[i] === "}") {
      i++;
      const val = params[name];
      out += val == null ? `{${name}}` : String(val);
      continue;
    }
    if (pattern[i] === ",") {
      i++;
      const fmtStart = i;
      while (i < len && pattern[i] !== "}") i++;
      const fmt = pattern.slice(fmtStart, i).trim();
      i++;
      const val = params[name];
      if (fmt.startsWith("plural")) {
        const inner = fmt.replace(/^plural\s*,?\s*/, "");
        const n = Number(val);
        out += resolvePlural(inner, name, Number.isFinite(n) ? n : 0, false);
        continue;
      }
      if (fmt.startsWith("selectordinal")) {
        const inner = fmt.replace(/^selectordinal\s*,?\s*/, "");
        const n = Number(val);
        out += resolvePlural(inner, name, Number.isFinite(n) ? n : 0, true);
        continue;
      }
      if (fmt.startsWith("select")) {
        const inner = fmt.replace(/^select\s*,?\s*/, "");
        out += resolveSelect(inner, name, String(val ?? ""));
        continue;
      }
      if (fmt === "number" || fmt.startsWith("number,")) {
        out += formatNumber(locale, Number(val), fmt.split(",")[1]?.trim());
        continue;
      }
      if (fmt === "date" || fmt.startsWith("date,")) {
        out += formatDate(locale, val, fmt.split(",")[1]?.trim());
        continue;
      }
      if (fmt.startsWith("relativeTime")) {
        const unit = (fmt.split(",")[1]?.trim() ?? "day") as Intl.RelativeTimeFormatUnit;
        out += formatRelativeTime(locale, Number(val), unit);
        continue;
      }
      out += val == null ? `{${name}, ${fmt}}` : String(val);
      continue;
    }
    out += `{${name}`;
  }
  return out;
}

export function flattenCatalog(catalog: Record<string, string | Record<string, unknown>>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(catalog)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else if (v && typeof v === "object") Object.assign(out, flattenCatalog(v as Record<string, string | Record<string, unknown>>, key));
  }
  return out;
}

export function unflattenCatalog(flat: Record<string, string>): Record<string, string | Record<string, unknown>> {
  const root: Record<string, string | Record<string, unknown>> = {};
  for (const [path, msg] of Object.entries(flat)) {
    const parts = path.split(".");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      if (typeof cur[p] !== "object" || cur[p] == null || typeof cur[p] === "string") cur[p] = {};
      cur = cur[p] as Record<string, string | Record<string, unknown>>;
    }
    cur[parts[parts.length - 1]!] = msg;
  }
  return root;
}

/** Extract `{placeholder}` names from a message pattern. */
export function extractPlaceholders(pattern: string): string[] {
  const names = new Set<string>();
  const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)(?:,\s*[^}]*)?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pattern))) names.add(m[1]!);
  return [...names].sort();
}

export function placeholderSetsMatch(a: string, b: string): boolean {
  const pa = extractPlaceholders(a).join(",");
  const pb = extractPlaceholders(b).join(",");
  return pa === pb;
}
