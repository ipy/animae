import type { Kernel, RetrievalHit } from "../contracts.ts";

const INSTRUCTIONS: Record<string, string> = {
  intensify: "Emphasise emotional intensity and certainty when recalling this memory.",
  swap_subject: "Swap who did what: treat the subject and object as reversed in this recollection.",
  add_motive: "Invent a plausible hidden motive that was not originally present.",
};

export async function applyDistortion(k: Kernel, hits: RetrievalHit[], rngKey: string): Promise<RetrievalHit[]> {
  const cfg = k.policy.memory.distortion ?? { enabled: false, p: 0.1, maxImportance: 0.7, kinds: ["intensify"] as const };
  if (!cfg.enabled || hits.length === 0) return hits;
  const rng = k.timeline.rng(rngKey);
  const out: RetrievalHit[] = [];
  for (const hit of hits) {
    const importance = hit.entry?.importance ?? hit.doc ? 0.5 : 1;
    if (importance > cfg.maxImportance) {
      out.push(hit);
      continue;
    }
    const hops = hit.entry?.hops ?? 0;
    const perHop = k.policy.memory.propagation?.distortionPerHop ?? 1;
    const p = Math.min(1, cfg.p + hops * perHop * 0.05);
    if (rng.next() >= p) {
      out.push(hit);
      continue;
    }
    const kind = rng.pick(cfg.kinds);
    const instruction = INSTRUCTIONS[kind] ?? INSTRUCTIONS.intensify!;
    const distorted: RetrievalHit = { ...hit, distortion: instruction, distortionKind: kind };
    out.push(distorted);
    await k.emit([
      {
        kind: "memory.distorted",
        source: "memory",
        memoryId: hit.id,
        distortionKind: kind,
        owner: hit.entry?.branch ? undefined : undefined,
      } as import("../types.ts").EventDraft,
    ]);
  }
  return out;
}

/** Bound distort method on the service (uses kernel from closure). */
export function bindDistort(k: Kernel): (hits: RetrievalHit[], rngKey: string) => Promise<RetrievalHit[]> {
  return (hits, rngKey) => applyDistortion(k, hits, rngKey);
}
