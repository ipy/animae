/**
 * Text for the `world/chapter` query. The engine answers `{ id, title? }` (or `null` outside every chapter); an older
 * host or test double may hand back a bare string. A title that is a localization reference instead of text falls back
 * to the id: the TUI has no catalog for the game's own strings.
 */
export function chapterLabel(chapter: unknown): string | undefined {
  if (typeof chapter === "string") return chapter || undefined;
  if (chapter && typeof chapter === "object") {
    const { id, title } = chapter as { id?: unknown; title?: unknown };
    if (typeof title === "string" && title) return title;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}
