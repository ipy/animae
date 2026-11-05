import {
  RUNTIME_MODE_PRESETS,
  RUNTIME_MODE_PRESET_VALUES,
  formatRuntimeMode,
  runtimeModePresetOf,
  s1Label,
  s2Label,
  type ModelsInfo,
  type RuntimeMode,
  type RuntimeModePreset,
  type S2TierInfo,
} from "@animae/engine";

export { s1Label, s2Label };

/** `RULE`, `S1:LLM S2:std`, `S1:LLM S2:RULE` or `S1:RULE S2:std` (without brackets). */
export const formatMode = formatRuntimeMode;

/**
 * Footer indicator: `[S1:LLM S2:std]`, `[RULE]`, `[S1:LLM S2:RULE]`. A change that waits for the turn boundary is
 * appended as `→ [next]`.
 */
export function modeIndicator(
  mode: RuntimeMode,
  models: Pick<ModelsInfo, "s2Default">,
  pending?: RuntimeMode | null,
): string {
  const now = `[${formatMode(mode, models)}]`;
  return pending ? `${now} → [${formatMode(pending, models)}]` : now;
}

/** Mode panel / `:mode` rows: the named presets, in the documented order. */
export const MODE_PRESET_ORDER: readonly RuntimeModePreset[] = RUNTIME_MODE_PRESETS;

/** Whether a mode can be selected with the models that are configured (a role on `llm` needs a model). */
export function modeAvailable(mode: Pick<RuntimeMode, "appraise" | "render">, models: Pick<ModelsInfo, "s1Llm" | "s2Tiers">): boolean {
  if (mode.appraise === "llm" && !models.s1Llm) return false;
  if (mode.render === "llm" && models.s2Tiers.length === 0) return false;
  return true;
}

/** Name of the preset a mode matches (re-exported for panel rows). */
export const presetOf = runtimeModePresetOf;

/** One selectable row of the mode panel. */
export type ModeRow =
  | { id: string; kind: "preset"; preset: RuntimeModePreset; available: boolean; current: boolean }
  | { id: string; kind: "tier"; tier: S2TierInfo; available: boolean; current: boolean };

/**
 * Rows of the mode panel: the four presets, then (with more than one S2 tier) the tiers sync renders can run on.
 * A preset is unavailable without the model it needs; tiers apply only while S2 runs on a model.
 */
export function modePanelRows(mode: RuntimeMode, models: Pick<ModelsInfo, "s1Llm" | "s2Tiers" | "s2Default">): ModeRow[] {
  const current = runtimeModePresetOf(mode);
  const rows: ModeRow[] = MODE_PRESET_ORDER.map((preset) => ({
    id: `preset:${preset}`,
    kind: "preset",
    preset,
    available: modeAvailable(RUNTIME_MODE_PRESET_VALUES[preset], models),
    current: preset === current,
  }));
  if (models.s2Tiers.length > 1) {
    const selected = mode.s2Tier ?? models.s2Default;
    for (const tier of models.s2Tiers) {
      rows.push({
        id: `tier:${tier.id}`,
        kind: "tier",
        tier,
        available: mode.render === "llm",
        current: mode.render === "llm" && tier.id === selected,
      });
    }
  }
  return rows;
}

/** Whether the TUI can show the mode: engines without `runtime` (test doubles, older builds) have nothing to show. */
export function hasRuntime(engine: { runtime?: unknown }): boolean {
  return typeof engine.runtime === "object" && engine.runtime !== null;
}
