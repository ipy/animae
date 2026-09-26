import type { LocaleNegotiationOptions } from "./types.ts";

const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

/** Normalize arbitrary locale tag toward BCP-47 (underscore → hyphen, lower region). */
export function normalizeLocaleTag(raw: string): string {
  const trimmed = raw.trim().replace(/_/g, "-");
  if (!trimmed) return "en";
  const parts = trimmed.split("-");
  const lang = parts[0]!.toLowerCase();
  const rest = parts.slice(1).map((p, i) => (i === 0 && p.length === 4 ? p[0]!.toUpperCase() + p.slice(1).toLowerCase() : p.toUpperCase()));
  return [lang, ...rest].join("-");
}

/** Build fallback chain: zh-TW → zh-CN → en style matching. */
export function buildFallbackChain(locale: string, extra?: readonly string[]): string[] {
  const tag = normalizeLocaleTag(locale);
  const chain: string[] = [];
  const push = (t: string) => {
    if (!chain.includes(t)) chain.push(t);
  };
  push(tag);
  const lang = tag.split("-")[0]!;
  if (lang === "zh") {
    if (tag !== "zh-CN") push("zh-CN");
    if (tag.startsWith("zh-") && tag !== "zh-Hans") push("zh-Hans");
  }
  // Every tag other than `en` itself ends in `en` (so `en-US` and `en-GB` reach the `en` catalog, as `zh-TW` does).
  if (tag !== "en") push("en");
  for (const t of extra ?? []) push(normalizeLocaleTag(t));
  return chain;
}

function parseEnvLocale(env: Record<string, string | undefined>): string | undefined {
  const animae = env.ANIMAE_LOCALE?.trim();
  if (animae) return normalizeLocaleTag(animae);
  for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const v = env[key];
    if (!v) continue;
    const base = v.split(".")[0]!.trim();
    if (base && base !== "C" && base !== "POSIX") return normalizeLocaleTag(base);
  }
  return undefined;
}

/** Parse Accept-Language header (simple q-value sort). */
export function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header?.trim()) return [];
  const parts = header.split(",").map((p) => p.trim()).filter(Boolean);
  const scored: { tag: string; q: number }[] = [];
  for (const part of parts) {
    const [tagRaw, ...params] = part.split(";").map((s) => s.trim());
    let q = 1;
    for (const param of params) {
      const m = /^q=([0-9.]+)$/.exec(param);
      if (m) q = Number(m[1]);
    }
    if (tagRaw) scored.push({ tag: normalizeLocaleTag(tagRaw), q });
  }
  scored.sort((a, b) => b.q - a.q);
  const out: string[] = [];
  for (const s of scored) {
    if (!out.includes(s.tag)) out.push(s.tag);
  }
  return out;
}

export function negotiateLocale(opts: LocaleNegotiationOptions = {}): string {
  const env = opts.env ?? (typeof process !== "undefined" ? process.env : {});
  const fromEnv = parseEnvLocale(env);
  const accepted = parseAcceptLanguage(opts.acceptLanguage);
  const candidates = [opts.explicit, fromEnv, ...accepted, opts.defaultLocale ?? "en"].filter(Boolean) as string[];
  return normalizeLocaleTag(candidates[0] ?? "en");
}

export function textDirection(locale: string): "ltr" | "rtl" {
  const lang = normalizeLocaleTag(locale).split("-")[0]!;
  return RTL_LOCALES.has(lang) ? "rtl" : "ltr";
}

/** Best matching locale from available catalog tags. */
export function matchAvailableLocale(requested: string, available: readonly string[]): string | undefined {
  const chain = buildFallbackChain(requested);
  const set = new Set(available.map(normalizeLocaleTag));
  for (const tag of chain) {
    if (set.has(tag)) return tag;
  }
  for (const a of available) {
    const lang = normalizeLocaleTag(a).split("-")[0]!;
    if (lang === normalizeLocaleTag(requested).split("-")[0]!) return a;
  }
  return undefined;
}
