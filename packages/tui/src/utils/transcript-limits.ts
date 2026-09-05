/** Cap stored transcript entries to avoid unbounded memory on long sessions. */
export const MAX_TRANSCRIPT_ENTRIES = 400;

/** Default visible transcript rows when terminal height is unknown. */
export const DEFAULT_TRANSCRIPT_VISIBLE_LINES = 14;

export function trimTranscript<T>(entries: T[]): T[] {
  if (entries.length <= MAX_TRANSCRIPT_ENTRIES) return entries;
  return entries.slice(entries.length - MAX_TRANSCRIPT_ENTRIES);
}

/** Estimate how many transcript lines fit below header/footer/chrome. */
export function transcriptVisibleLineBudget(totalRows: number): number {
  const chrome = 10;
  return Math.max(8, totalRows - chrome);
}

/** Entry window size from line budget (rough average lines per entry). */
export function transcriptEntryWindow(totalRows: number): number {
  const lines = transcriptVisibleLineBudget(totalRows);
  return Math.max(12, Math.ceil(lines / 2));
}
