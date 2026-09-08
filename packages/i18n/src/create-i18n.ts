import { formatMessage, flattenCatalog } from "./format-message.ts";
import { applyPseudoLocale } from "./pseudo-locale.ts";
import { buildFallbackChain, normalizeLocaleTag, textDirection } from "./negotiate.ts";
import type { CreateI18nOptions, FormatParams, I18nInstance } from "./types.ts";

const warnedMissing = new Set<string>();

function resolveKey(
  flatByNs: Record<string, Record<string, Record<string, string>>>,
  chain: readonly string[],
  ns: string,
  key: string,
): string | undefined {
  const tables = flatByNs[ns];
  if (!tables) return undefined;
  for (const loc of chain) {
    const hit = tables[loc]?.[key];
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function splitKey(key: string, defaultNs: string): { ns: string; path: string } {
  if (key.includes(":")) {
    const [ns, ...rest] = key.split(":");
    return { ns: ns!, path: rest.join(":") };
  }
  if (key.includes(".") && !key.startsWith("error.")) {
    const dot = key.indexOf(".");
    const maybeNs = key.slice(0, dot);
    if (maybeNs.length <= 24 && /^[a-z][a-z0-9_-]*$/.test(maybeNs)) {
      return { ns: maybeNs, path: key.slice(dot + 1) };
    }
  }
  return { ns: defaultNs, path: key };
}

export function createI18n(opts: CreateI18nOptions): I18nInstance {
  const locale = normalizeLocaleTag(opts.locale);
  const fallbackChain = opts.fallbackChain?.length ? opts.fallbackChain.map(normalizeLocaleTag) : buildFallbackChain(locale);
  const defaultNamespace = opts.defaultNamespace ?? "common";
  const dev = opts.dev ?? (typeof process !== "undefined" && process.env?.NODE_ENV !== "production");
  const missingKey = opts.missingKey ?? "key";

  const flatByNs: Record<string, Record<string, Record<string, string>>> = {};
  for (const [ns, byLocale] of Object.entries(opts.catalogs)) {
    flatByNs[ns] = {};
    for (const [loc, catalog] of Object.entries(byLocale)) {
      flatByNs[ns]![normalizeLocaleTag(loc)] = flattenCatalog(catalog);
    }
  }

  function makeInstance(activeLocale: string, chain: readonly string[]): I18nInstance {
    const translate = (key: string, params?: FormatParams, o?: { ns?: string }): string => {
      const { ns, path } = o?.ns ? { ns: o.ns, path: key } : splitKey(key, defaultNamespace);
      let msg = resolveKey(flatByNs, chain, ns, path);
      if (msg === undefined) {
        const warnId = `${ns}:${path}@${activeLocale}`;
        if (dev && !warnedMissing.has(warnId)) {
          warnedMissing.add(warnId);
          console.warn(`[i18n] missing key ${ns}:${path} (locale ${activeLocale})`);
        }
        if (missingKey === "empty") return "";
        if (missingKey === "fallback" && chain.length > 1) {
          msg = resolveKey(flatByNs, chain.slice(1), ns, path);
        }
        if (msg === undefined) return missingKey === "key" ? `${ns}:${path}` : key;
      }
      return formatMessage(activeLocale, msg, params ?? {});
    };

    return {
      locale: activeLocale,
      fallbackChain: chain,
      t: translate,
      has(key, o) {
        const { ns, path } = o?.ns ? { ns: o.ns, path: key } : splitKey(key, defaultNamespace);
        return resolveKey(flatByNs, chain, ns, path) !== undefined;
      },
      dir: () => textDirection(activeLocale),
      withLocale(l, fb) {
        const tag = normalizeLocaleTag(l);
        const c = fb?.length ? fb.map(normalizeLocaleTag) : buildFallbackChain(tag);
        return makeInstance(tag, c);
      },
      tPseudo(key, params, o) {
        return applyPseudoLocale(translate(key, params, o), activeLocale);
      },
    };
  }

  return makeInstance(locale, fallbackChain);
}
