import { createTuiI18n } from "../i18n/tui-i18n.ts";

export function formatTierLabel(tierName: string, uiLocale?: string): string {
  const i18n = createTuiI18n(uiLocale);
  const key = `tiers.${tierName}`;
  if (i18n.has(key, { ns: "tui" })) return i18n.t(key, undefined, { ns: "tui" });
  return tierName.replace(/_/g, " ");
}

export function formatTrackLabel(trackKey: string, _language?: string): string {
  return trackKey;
}

/** Heuristic: treat chapter titles with CJK as zh display context. */
export function inferZhLanguage(chapter: unknown): boolean {
  if (typeof chapter !== "string") return false;
  return /[\u4e00-\u9fff]/.test(chapter);
}
