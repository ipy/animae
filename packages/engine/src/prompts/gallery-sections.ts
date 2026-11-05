import enGallery from "./en/gallery.json" with { type: "json" };
import { localeCatalogs, localePacksVersion, matchAvailableLocale } from "@animae/i18n";

export type GalleryPromptSectionKey = keyof typeof enGallery;

type Bundles = Record<string, Record<string, string>>;

let cached: { version: number; bundles: Bundles } | undefined;

/** The gallery prompt text of every locale: English plus the `gallery-prompts` catalog of each registered locale pack. */
function bundles(): Bundles {
  const version = localePacksVersion();
  if (cached?.version === version) return cached.bundles;
  const merged = localeCatalogs("gallery-prompts", { en: enGallery }) as unknown as Bundles;
  cached = { version, bundles: merged };
  return merged;
}

export function getGalleryPromptSection(
  locale: string,
  key: GalleryPromptSectionKey,
  vars?: Record<string, string | number>,
): string {
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

/** Sections the English gallery bundle has and `locale`'s lacks (`missing`), and sections only `locale` has (`extra`). */
export function galleryPromptLocaleParityKeys(locale: string): { missing: GalleryPromptSectionKey[]; extra: string[] } {
  const all = bundles();
  const tag = matchAvailableLocale(locale, Object.keys(all).filter((l) => l !== "en"));
  const enKeys = Object.keys(enGallery) as GalleryPromptSectionKey[];
  if (!tag) return { missing: enKeys, extra: [] };
  const keys = Object.keys(all[tag]!);
  return { missing: enKeys.filter((k) => !keys.includes(k)), extra: keys.filter((k) => !(k in enGallery)) };
}
