import { SINGLE_TIER_ID } from "../model/tier-resolver.ts";
import {
  isRuntimeModePreset,
  type ModelsInfo,
  type RuntimeMode,
  type RuntimeModePreset,
  type RuntimeModeRequest,
} from "./types.ts";

/** How the S1 role is named in a mode label. */
export function s1Label(mode: Pick<RuntimeMode, "appraise">): string {
  return mode.appraise === "llm" ? "LLM" : "RULE";
}

/**
 * How the S2 role is named in a mode label: `RULE`, the tier id when the engine has named tiers (`std`, `pro`),
 * otherwise plain `LLM` (a single unnamed model needs no tier name).
 */
export function s2Label(mode: RuntimeMode, models: Pick<ModelsInfo, "s2Default">): string {
  if (mode.render === "rule") return "RULE";
  const tier = mode.s2Tier ?? models.s2Default;
  if (!tier || tier === SINGLE_TIER_ID) return "LLM";
  return tier;
}

/**
 * Compact label of a runtime mode, the same everywhere it is shown (footer, `:mode`, logs): `RULE` when both roles
 * run on rules, otherwise `S1:LLM S2:std`, `S1:LLM S2:RULE` or `S1:RULE S2:std`.
 */
export function formatRuntimeMode(mode: RuntimeMode, models: Pick<ModelsInfo, "s2Default">): string {
  if (mode.appraise === "rule" && mode.render === "rule") return "RULE";
  return `S1:${s1Label(mode)} S2:${s2Label(mode, models)}`;
}

/**
 * Parse the arguments of a `:mode` command into a switch request:
 * `<preset>`, `s1 llm|rule`, `s2 llm|rule` or `s2 <tier id>` (an S2 tier implies `render: llm`).
 * Returns `undefined` for anything else; callers print their usage text.
 */
export function parseModeRequest(args: readonly string[]): RuntimeModePreset | RuntimeModeRequest | undefined {
  const head = (args[0] ?? "").toLowerCase();
  if (isRuntimeModePreset(head)) return head;
  const value = args[1];
  if (head === "s1" && (value === "llm" || value === "rule")) return { appraise: value };
  if (head === "s2" && (value === "llm" || value === "rule")) return { render: value };
  if (head === "s2" && value) return { render: "llm", s2Tier: value };
  return undefined;
}
