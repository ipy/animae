import stringWidth from "string-width";
import { graphemes, sliceGraphemes } from "./grapheme.ts";

export function displayWidth(text: string): number {
  return stringWidth(text);
}

/** Truncate to max display columns, preserving grapheme boundaries. */
export function truncateToWidth(text: string, maxCols: number, ellipsis = "…"): string {
  if (maxCols <= 0) return "";
  if (displayWidth(text) <= maxCols) return text;
  const ellW = displayWidth(ellipsis);
  const budget = Math.max(0, maxCols - ellW);
  let out = "";
  for (const g of graphemes(text)) {
    const next = out + g;
    if (displayWidth(next) > budget) break;
    out = next;
  }
  return out + ellipsis;
}

/** Split text into lines that fit within maxCols display width. */
export function wrapToWidth(text: string, maxCols: number): string[] {
  if (maxCols < 1) return [text];
  const lines: string[] = [];
  let current = "";
  for (const g of graphemes(text)) {
    const trial = current + g;
    if (displayWidth(trial) > maxCols && current.length > 0) {
      lines.push(current);
      current = g.trimStart() === g ? g : g;
      if (displayWidth(current) > maxCols) {
        lines.push(truncateToWidth(current, maxCols, ""));
        current = "";
      }
    } else {
      current = trial;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length ? lines : [""];
}

/** Cursor index in graphemes from display column target (for input editing). */
export function graphemeIndexAtColumn(text: string, col: number): number {
  let w = 0;
  const gs = graphemes(text);
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i]!;
    const gw = displayWidth(g);
    if (w + gw > col) return i;
    w += gw;
  }
  return gs.length;
}

export function columnAtGraphemeIndex(text: string, index: number): number {
  return displayWidth(sliceGraphemes(text, 0, index));
}

export function insertAtGrapheme(text: string, index: number, insert: string): string {
  const gs = graphemes(text);
  const before = gs.slice(0, index).join("");
  const after = gs.slice(index).join("");
  return before + insert + after;
}

export function deleteGraphemeBefore(text: string, index: number): { text: string; cursor: number } {
  if (index <= 0) return { text, cursor: 0 };
  const gs = graphemes(text);
  const next = gs.slice(0, index - 1).join("") + gs.slice(index).join("");
  return { text: next, cursor: index - 1 };
}

export function deleteGraphemeAfter(text: string, index: number): string {
  const gs = graphemes(text);
  return gs.slice(0, index).join("") + gs.slice(index + 1).join("");
}
