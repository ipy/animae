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

/** Entries one PgUp/PgDn moves: about half a screen, so the reader keeps context. */
export function transcriptPageStep(totalRows: number): number {
  return Math.max(4, Math.floor(transcriptVisibleLineBudget(totalRows) / 2));
}

/**
 * How many of the newest entries the transcript pane renders. An entry takes at least one line, so as many
 * entries as the pane has lines always fill it, whatever the mix of one-line and multi-line entries; the
 * pane clips the oldest rows.
 */
export function transcriptEntryWindow(totalRows: number): number {
  return Math.max(12, transcriptVisibleLineBudget(totalRows));
}
