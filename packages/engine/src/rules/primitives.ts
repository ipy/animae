type Tier = { name: string; from: number };

export function tierFor(
  value: number,
  tiers: Tier[],
  current: string | null,
  hysteresis: number,
): { tier: string | null; direction: "up" | "down" | "same" } {
  if (tiers.length === 0) return { tier: null, direction: "same" };

  const sorted = [...tiers].sort((a, b) => a.from - b.from);
  let candidate: string | null = null;
  for (const t of sorted) {
    if (value >= t.from) candidate = t.name;
  }

  if (current === null) {
    return { tier: candidate, direction: candidate ? "up" : "same" };
  }

  const curDef = sorted.find((t) => t.name === current);
  if (!curDef) return { tier: candidate, direction: candidate === current ? "same" : candidate ? "up" : "down" };

  const h = hysteresis;
  if (candidate === current) return { tier: current, direction: "same" };

  const curIdx = sorted.findIndex((t) => t.name === current);
  const candIdx = candidate ? sorted.findIndex((t) => t.name === candidate) : -1;

  if (candIdx > curIdx) {
    const target = sorted[candIdx]!;
    if (value >= target.from + h) return { tier: candidate, direction: "up" };
    return { tier: current, direction: "same" };
  }

  if (candIdx < curIdx) {
    const curTier = sorted[curIdx]!;
    if (value < curTier.from - h) return { tier: candidate, direction: "down" };
    return { tier: current, direction: "same" };
  }

  return { tier: current, direction: "same" };
}

export function marginal(nPrior: number, k: number): number {
  const n = Math.max(0, nPrior);
  return 1 / (1 + k * n);
}

export function decayedCounter(n: number, lastMinutes: number, nowMinutes: number, halfLifeHours: number): number {
  if (halfLifeHours <= 0) return n;
  const hours = Math.abs(nowMinutes - lastMinutes) / 60;
  const factor = 0.5 ** (hours / halfLifeHours);
  return n * factor;
}

export interface DeltaFactors {
  base: number;
  intensity: number;
  sincerity: number;
  sincerityFactor: number;
  traitMult: number;
  marginal: number;
  trackMult: number;
}

/** Shared rule primitive helpers (see docs/architecture.md). */
export function computeDelta(f: DeltaFactors): number {
  const sincerityFactor = f.base > 0 ? f.sincerity : 1;
  const raw = f.base * f.intensity * sincerityFactor * f.traitMult * f.marginal * f.trackMult;
  return Math.round(raw * 100) / 100;
}

export function applyTurnCap(
  proposedDelta: number,
  track: string,
  turnAcc: Record<string, number>,
  cap: number | undefined,
): { delta: number; acc: Record<string, number> } {
  if (cap === undefined || cap <= 0) {
    const acc = { ...turnAcc, [track]: (turnAcc[track] ?? 0) + proposedDelta };
    return { delta: proposedDelta, acc };
  }
  const used = turnAcc[track] ?? 0;
  const remaining = cap - Math.abs(used);
  if (remaining <= 0) return { delta: 0, acc: turnAcc };
  let d = proposedDelta;
  if (Math.abs(d) > remaining) d = Math.sign(d) * remaining;
  const acc = { ...turnAcc, [track]: used + d };
  return { delta: d, acc };
}

export function decayStep(value: number, cfg: { toward: number; ratePerHour: number }, hours: number): number {
  if (hours <= 0 || cfg.ratePerHour <= 0) return value;
  const factor = 1 - (1 - cfg.ratePerHour) ** hours;
  return value + (cfg.toward - value) * factor;
}
