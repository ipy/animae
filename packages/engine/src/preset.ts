import type { Template } from "./schema/authored.ts";
import type { Policy } from "./schema/policy.ts";
import type { RuleFn } from "./contracts.ts";

/**
 * A preset (spec §19.2) as an in-memory bundle. Preset packages (`@animae/preset-*`) export a `PresetBundle`
 * (generated from their YAML sources by `scripts/gen-bundle.ts`) so that presets work inside the
 * single-file executable without touching the filesystem. Filesystem presets (directory with `preset.yaml`)
 * are converted to the same shape by `loadPresetDir`.
 */
export interface PresetBundle {
  id: string;
  /** ids of presets this one extends (resolved against the registry) */
  extends: string[];
  /** policy documents, in order; each is a (partial) Policy (pre-validation, may contain $append/$prepend) */
  policies: { name: string; doc: unknown }[];
  templates?: { kind: "character" | "location" | "item"; id: string; template: Template }[];
  /** knowledge docs: path relative to the data root's world/knowledge (e.g. "preset/dnd/skills.md") → markdown text with frontmatter */
  knowledge?: Record<string, string>;
  /** registers rule functions into the engine (called once at engine creation) */
  rules?: (reg: { register(name: string, fn: RuleFn): void }) => void;
  /** license/attribution text that must ship with the preset */
  notice?: string;
}

export type PresetPolicyDoc = Policy;
