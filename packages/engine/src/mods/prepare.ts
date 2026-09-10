import type { StoragePort } from "../ports.ts";
import type { ModBundle, ModSelection, ResolvedMod } from "../mod.ts";
import type { ModProvenanceEntry } from "../mod.ts";
import { createLayeredStorage, type ModStorageLayer } from "./layered-storage.ts";
import { resolveMods } from "./resolve.ts";

export interface ModOverlayContext {
  ordered: ResolvedMod[];
  bundles: ModBundle[];
  layers: ModStorageLayer[];
  provenance: Map<string, ModProvenanceEntry>;
  warnings: string[];
}

export async function prepareModOverlay(
  base: StoragePort,
  configMods: string[],
  opts?: {
    selection?: ModSelection;
    bundles?: ModBundle[];
    engineVersion?: string;
    contentLocaleChain?: readonly string[];
  },
): Promise<ModOverlayContext & { readStorage: StoragePort }> {
  const provenance = new Map<string, ModProvenanceEntry>();
  const { ordered, layers, bundles, warnings } = await resolveMods(base, configMods, opts);
  const readStorage = createLayeredStorage({
    base,
    modLayers: layers,
    provenance,
    contentLocaleChain: opts?.contentLocaleChain,
  });
  return { ordered, bundles, layers, provenance, warnings, readStorage };
}
