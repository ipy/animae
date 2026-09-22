import type { PresetRegistry } from "../contracts.ts";
import { resolvePresetChain } from "../policy/registry.ts";

/** Merge `displayStrings` from the active preset chain (later presets override earlier keys). */
export function collectPresetDisplayStrings(
  registry: PresetRegistry,
  presetId: string | undefined,
): Record<string, Record<string, string>> {
  if (!presetId) return {};
  const merged: Record<string, Record<string, string>> = {};
  for (const bundle of resolvePresetChain(registry, presetId)) {
    const tables = bundle.displayStrings;
    if (!tables) continue;
    for (const [locale, table] of Object.entries(tables)) {
      merged[locale] = { ...merged[locale], ...table };
    }
  }
  return merged;
}

/** Wrap merged preset tables for `@animae/i18n` catalogs (`strings` namespace, flat keys). */
export function presetDisplayStringsCatalog(
  merged: Record<string, Record<string, string>>,
): { strings: Record<string, Record<string, string>> } {
  return { strings: { ...merged } };
}

/** Later tables override earlier keys per locale (game overlays win over preset defaults). */
export function mergeDisplayStringTables(
  base: Record<string, Record<string, string>>,
  override: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = { ...base };
  for (const [locale, table] of Object.entries(override)) {
    out[locale] = { ...(out[locale] ?? {}), ...table };
  }
  return out;
}
