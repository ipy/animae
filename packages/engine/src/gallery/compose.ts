/** Deterministic prompt composition for gallery renders (documented in docs/gallery.md). */

export function dedupeJoin(parts: readonly string[], sep: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    for (const piece of p.split(sep).map((s) => s.trim()).filter(Boolean)) {
      const key = piece.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(piece);
    }
  }
  return out.join(sep);
}

export interface ComposeGalleryPromptsInput {
  galleryStyle: string;
  galleryNegative: string;
  ratingStyle: string;
  ratingNegative: string;
  characterVisuals: readonly string[];
  renderPrompt: string;
  renderNegative: string;
}

export function composeGalleryPrompts(input: ComposeGalleryPromptsInput): { prompt: string; negative: string } {
  const prompt = dedupeJoin(
    [input.galleryStyle, input.ratingStyle, ...input.characterVisuals, input.renderPrompt],
    ", ",
  );
  const negative = dedupeJoin(
    [input.galleryNegative, input.ratingNegative, input.renderNegative],
    ", ",
  );
  return { prompt, negative };
}
