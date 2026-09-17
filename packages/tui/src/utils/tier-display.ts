import { createTuiI18n } from "../i18n/tui-i18n.ts";

export function formatTierLabel(tierName: string, uiLocale?: string): string {
  const i18n = createTuiI18n(uiLocale);
  const key = `tiers.${tierName}`;
  if (i18n.has(key, { ns: "tui" })) return i18n.t(key, undefined, { ns: "tui" });
  return tierName.replace(/_/g, " ");
}

export function formatTrackLabel(trackKey: string, uiLocale?: string): string {
  const i18n = createTuiI18n(uiLocale);
  const key = `tracks.${trackKey}`;
  if (i18n.has(key, { ns: "tui" })) return i18n.t(key, undefined, { ns: "tui" });
  return trackKey;
}
