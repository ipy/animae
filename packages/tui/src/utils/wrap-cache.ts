import { wrapToWidth } from "./display-width.ts";

const cache = new Map<string, string[]>();
const MAX = 800;

export function cachedWrapToWidth(text: string, cols: number): string[] {
  const key = `${cols}\0${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const lines = wrapToWidth(text, cols);
  if (cache.size >= MAX) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, lines);
  return lines;
}
