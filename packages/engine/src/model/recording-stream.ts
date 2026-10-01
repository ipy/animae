import type { StreamPart } from "../ports.ts";
import { stableStringify } from "../store/util.ts";

export function isStreamPart(value: unknown): value is StreamPart {
  if (value === null || typeof value !== "object") return false;
  const t = (value as { type?: unknown }).type;
  return t === "partial" || t === "tool" || t === "final";
}

export function isStreamPartsResponse(response: unknown): response is StreamPart[] {
  return Array.isArray(response) && response.length > 0 && response.every(isStreamPart);
}

/** Drop cumulative partials before persisting a stream recording. */
export function slimStreamPartsForRecord(parts: StreamPart[]): StreamPart[] {
  return parts.filter((p) => p.type !== "partial");
}

export function recordingResponseEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Replay stored stream parts. Legacy rows keep every partial; slim rows (no partials) re-emit tools then one
 * synthesized partial (final value) before final so streaming consumers still see a partial/final pair.
 */
export async function* replayStreamParts(parts: StreamPart[]): AsyncGenerator<StreamPart> {
  if (parts.some((p) => p.type === "partial")) {
    for (const p of parts) yield p;
    return;
  }
  for (const p of parts) {
    if (p.type === "final") {
      yield { type: "partial", value: p.value };
      yield p;
    } else {
      yield p;
    }
  }
}

export function countDroppedPartialsInResponse(response: unknown): number {
  if (!isStreamPartsResponse(response)) return 0;
  return response.filter((p) => p.type === "partial").length;
}

export function normalizeStreamResponseForStorage(response: unknown): { response: unknown; droppedPartials: number } {
  if (!isStreamPartsResponse(response)) return { response, droppedPartials: 0 };
  const droppedPartials = countDroppedPartialsInResponse(response);
  if (droppedPartials === 0) return { response, droppedPartials: 0 };
  return { response: slimStreamPartsForRecord(response), droppedPartials };
}
