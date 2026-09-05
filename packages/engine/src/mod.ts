import type { RuleFn, Stage, StageHook, ViewerDef } from "./contracts.ts";

/**
 * Content mod manifest (see docs/mods.md). Filesystem: `mods/<id>/mod.yaml` + overlay tree mirroring the data root.
 * Embedded: `ModBundle` with `files: Record<dataRootPath, utf8>`.
 */
export interface ModManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** semver range against `@animae/engine` — mismatch emits a warning only */
  engine?: string;
  requires?: string[];
  conflicts?: string[];
  loadAfter?: string[];
  /** free-form label (e.g. "adult"); engine does not interpret */
  rating?: string;
  tags?: string[];
  /** host app should show before enabling */
  notice?: string;
  provides?: string[];
}

/** Extension surface for code mods — same registrations as `createEngine` public API (I7). */
export interface ModSetupCtx {
  rules: { register(name: string, fn: RuleFn): void };
  hooks: { register(stage: Stage, fn: StageHook): void };
  introspect: { registerViewer(v: ViewerDef): void };
}

export interface ModBundle {
  manifest: ModManifest;
  /** paths relative to the data root (POSIX), utf-8 text */
  files: Record<string, string>;
  /** called once at engine creation when the mod is enabled; never auto-run from disk in v1 */
  setup?: (ctx: ModSetupCtx) => void;
}

export interface ResolvedMod {
  id: string;
  name: string;
  version: string;
  rating?: string;
  tags: string[];
  /** sha256 of all overlay file contents (sorted paths) */
  contentHash: string;
  source: "filesystem" | "bundle";
}

export type ModSelection = string[] | { id: string; enabled: boolean }[];

export interface ModProvenanceEntry {
  layer: "base" | "preset" | "mod";
  id?: string;
}
