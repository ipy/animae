import { graphemeCount } from "./grapheme.ts";

/** Milliseconds until `visible` graphemes should be shown at `charsPerSecond`. */
export function typewriterDelayMs(
  visible: number,
  charsPerSecond: number,
): number {
  if (charsPerSecond <= 0) return 0;
  return Math.ceil((visible / charsPerSecond) * 1000);
}

export function nextTypewriterTick(
  currentVisible: number,
  total: number,
  charsPerSecond: number,
): { visible: number; delayMs: number } | { done: true } {
  if (currentVisible >= total) return { done: true };
  const visible = currentVisible + 1;
  return {
    visible,
    delayMs: typewriterDelayMs(1, charsPerSecond),
  };
}

export function totalGraphemes(text: string): number {
  return graphemeCount(text);
}
