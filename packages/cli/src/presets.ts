import type { PresetBundle } from "@animae/engine";
import * as presetBaseMod from "@animae/preset-base";
import * as presetDndMod from "@animae/preset-dnd";
import * as presetRuleMod from "@animae/preset-rule";

function extractPreset(mod: Record<string, unknown>): PresetBundle | undefined {
  const candidate = mod.preset ?? mod.default;
  if (candidate && typeof candidate === "object" && "id" in candidate && typeof (candidate as PresetBundle).id === "string") {
    return candidate as PresetBundle;
  }
  return undefined;
}

const BUILTIN_MODULES = [presetBaseMod, presetDndMod, presetRuleMod] as const;

/** Eagerly resolved so `bun build --compile` always retains every bundle in the graph. */
export const BUILTIN_PRESET_BUNDLES: PresetBundle[] = BUILTIN_MODULES.map((mod) =>
  extractPreset(mod as Record<string, unknown>),
).filter((p): p is PresetBundle => p !== undefined);

/** Built-in presets shipped with the CLI (preset-base, preset-dnd and preset-rule). */
export async function builtinPresets(): Promise<PresetBundle[]> {
  return BUILTIN_PRESET_BUNDLES;
}

export async function resolvePresetId(id: string): Promise<PresetBundle | undefined> {
  return (await builtinPresets()).find((p) => p.id === id);
}
