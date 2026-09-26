import enSections from "./en/sections.json" with { type: "json" };
import zhSections from "./zh-CN/sections.json" with { type: "json" };
import { matchAvailableLocale, normalizeLocaleTag } from "@animae/i18n";

export type PromptSectionKey = keyof typeof enSections;

const bundles: Record<string, Record<PromptSectionKey, string>> = {
  en: enSections as Record<PromptSectionKey, string>,
  "zh-CN": zhSections as Record<PromptSectionKey, string>,
};

export const PROMPT_LOCALES = Object.keys(bundles).sort();

export function getPromptSection(locale: string, key: PromptSectionKey, vars?: Record<string, string | number>): string {
  const tag = matchAvailableLocale(locale, PROMPT_LOCALES) ?? "en";
  let text = bundles[tag]![key] ?? bundles.en![key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function promptLocaleParityKeys(): { en: PromptSectionKey[]; zh: PromptSectionKey[]; missing: PromptSectionKey[] } {
  const enKeys = Object.keys(enSections) as PromptSectionKey[];
  const zhKeys = Object.keys(zhSections) as PromptSectionKey[];
  const missing = enKeys.filter((k) => !zhKeys.includes(k));
  return { en: enKeys, zh: zhKeys, missing };
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
