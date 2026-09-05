const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

/** Split string into Unicode grapheme clusters. */
export function graphemes(text: string): string[] {
  if (!text) return [];
  if (segmenter) {
    return [...segmenter.segment(text)].map((s) => s.segment);
  }
  return [...text];
}

export function graphemeCount(text: string): number {
  return graphemes(text).length;
}

export function sliceGraphemes(text: string, start: number, end?: number): string {
  const gs = graphemes(text);
  return gs.slice(start, end).join("");
}
