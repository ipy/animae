export { ModManifestSchema, type ModManifestDoc } from "./manifest.ts";
export { applyPatchMerge } from "./patch-merge.ts";
export { createLayeredStorage, type ModStorageLayer } from "./layered-storage.ts";
export {
  resolveMods,
  loadModManifestFromDir,
  modFingerprint,
  modDrift,
  type ModResolveResult,
} from "./resolve.ts";
export { prepareModOverlay, type ModOverlayContext } from "./prepare.ts";
export { explainAuthoredPath, formatExplainLine, type ExplainLayerLine } from "./explain.ts";
