/** User-visible copy that may be fixed or resolved at render time (e.g. after `:lang`). */
export type ResolvableText = string | (() => string);

export function resolveText(value: ResolvableText | undefined): string {
  if (value === undefined) return "";
  return typeof value === "function" ? value() : value;
}
