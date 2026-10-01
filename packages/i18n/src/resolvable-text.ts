/**
 * User-visible copy that may be fixed or resolved when it is read (for example after a locale switch).
 * A function is evaluated at read time, so it picks up the locale that is active for the reader
 * (a web viewer's request scope, or the process locale of a terminal UI).
 */
export type ResolvableText = string | (() => string);

/** Read a {@link ResolvableText}; `undefined` reads as the empty string. */
export function resolveText(value: ResolvableText | undefined): string {
  if (value === undefined) return "";
  return typeof value === "function" ? value() : value;
}
