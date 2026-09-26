import enGallery from "./en/gallery.json" with { type: "json" };
import zhGallery from "./zh-CN/gallery.json" with { type: "json" };
import { matchAvailableLocale, normalizeLocaleTag } from "@animae/i18n";

export type GalleryPromptSectionKey = keyof typeof enGallery;

const bundles: Record<string, Record<GalleryPromptSectionKey, string>> = {
  en: enGallery as Record<GalleryPromptSectionKey, string>,
  "zh-CN": zhGallery as Record<GalleryPromptSectionKey, string>,
};

const LOCALES = Object.keys(bundles).sort();

export function getGalleryPromptSection(
  locale: string,
  key: GalleryPromptSectionKey,
  vars?: Record<string, string | number>,
): string {
  const tag = matchAvailableLocale(locale, LOCALES) ?? "en";
  let text = bundles[tag]![key] ?? bundles.en![key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function galleryPromptLocaleParityKeys(): { en: GalleryPromptSectionKey[]; zh: GalleryPromptSectionKey[]; missing: GalleryPromptSectionKey[] } {
  const enKeys = Object.keys(enGallery) as GalleryPromptSectionKey[];
  const zhKeys = Object.keys(zhGallery) as GalleryPromptSectionKey[];
  const missing = enKeys.filter((k) => !zhKeys.includes(k));
  return { en: enKeys, zh: zhKeys, missing };
}
