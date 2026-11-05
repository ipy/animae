import enSections from "./en/sections.json" with { type: "json" };
import { localeCatalogs, localePacksVersion, matchAvailableLocale, normalizeLocaleTag } from "@animae/i18n";

export type PromptSectionKey = keyof typeof enSections;

type Bundles = Record<string, Record<string, string>>;

let cached: { version: number; bundles: Bundles } | undefined;

/** The prompt text of every locale: the English bundle plus the `prompts` catalog of each registered locale pack. */
function bundles(): Bundles {
  const version = localePacksVersion();
  if (cached?.version === version) return cached.bundles;
  const merged = localeCatalogs("prompts", { en: enSections }) as unknown as Bundles;
  cached = { version, bundles: merged };
  return merged;
}

/** Locales that have prompt text: `en` and every registered locale pack that provides `prompts`. */
export function promptLocales(): string[] {
  return Object.keys(bundles()).sort();
}

/**
 * One prompt section in `locale`, with `{name}` placeholders replaced from `vars`. A locale without a bundle, or a bundle
 * without this section, reads the English text.
 */
export function getPromptSection(locale: string, key: PromptSectionKey, vars?: Record<string, string | number>): string {
  const all = bundles();
  const tag = matchAvailableLocale(locale, Object.keys(all)) ?? "en";
  let text = all[tag]?.[key] ?? all.en![key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

/** Sections the English bundle has and `locale`'s bundle lacks (`missing`), and sections only `locale` has (`extra`). */
export function promptLocaleParityKeys(locale: string): { missing: PromptSectionKey[]; extra: string[] } {
  const all = bundles();
  const tag = matchAvailableLocale(locale, Object.keys(all).filter((l) => l !== "en"));
  const enKeys = Object.keys(enSections) as PromptSectionKey[];
  if (!tag) return { missing: enKeys, extra: [] };
  const keys = Object.keys(all[tag]!);
  return { missing: enKeys.filter((k) => !keys.includes(k)), extra: keys.filter((k) => !(k in enSections)) };
}

export { getGalleryPromptSection, galleryPromptLocaleParityKeys } from "./gallery-sections.ts";

export function displayLanguageName(tag: string, uiLocale: string): string {
  try {
    const dn = new Intl.DisplayNames([normalizeLocaleTag(uiLocale)], { type: "language" });
    return dn.of(normalizeLocaleTag(tag)) ?? tag;
  } catch {
    return tag;
  }
}
