/**
 * Seeded picking for the rule backend. Every draw comes from the `rng` the caller passes in (`ModelCallContext.rng`,
 * seeded from the timeline seed and the turn), never from `Math.random`, so a rule-backend run is reproducible.
 */

export interface Weighted {
  weight: number;
}

/** One weighted draw; `items` must not be empty. A single `rng()` call is consumed even for one item. */
export function weightedPick<T extends Weighted>(items: readonly T[], rng: () => number): T {
  if (items.length === 0) throw new Error("weightedPick: empty pool");
  let total = 0;
  for (const it of items) total += it.weight > 0 ? it.weight : 0;
  const draw = rng();
  if (total <= 0) return items[Math.min(items.length - 1, Math.floor(draw * items.length))]!;
  let at = draw * total;
  for (const it of items) {
    const w = it.weight > 0 ? it.weight : 0;
    if (at < w) return it;
    at -= w;
  }
  return items[items.length - 1]!;
}

/** Uniform pick from a non-empty array. */
export function uniformPick<T>(items: readonly T[], rng: () => number): T {
  if (items.length === 0) throw new Error("uniformPick: empty array");
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}
