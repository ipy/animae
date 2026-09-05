import type { ModProvenanceEntry } from "../mod.ts";

export interface ExplainLayerLine {
  path: string;
  layer: ModProvenanceEntry;
}

/** Which mod (or base) last supplied a logical authored path (after reads through layered storage). */
export function explainAuthoredPath(provenance: Map<string, ModProvenanceEntry>, path: string): ExplainLayerLine | undefined {
  const layer = provenance.get(path);
  if (!layer) return undefined;
  return { path, layer };
}

export function formatExplainLine(line: ExplainLayerLine): string {
  if (line.layer.layer === "base") return `${line.path}\tbase`;
  if (line.layer.layer === "preset") return `${line.path}\tpreset:${line.layer.id ?? "?"}`;
  return `${line.path}\tmod:${line.layer.id ?? "?"}`;
}
