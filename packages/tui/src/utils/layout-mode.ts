export type LayoutMode = "two-column" | "single-column" | "too-small";

export function selectLayoutMode(cols: number, rows: number): LayoutMode {
  if (cols < 80 || rows < 24) return "too-small";
  if (cols >= 100) return "two-column";
  return "single-column";
}
