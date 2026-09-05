import type { MemoryEntry, RetrievalHit } from "../contracts.ts";
import type { KnowledgeDoc } from "../schema/authored.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import { ageWorldDays, forgettingRetention } from "./util.ts";

export { forgettingRetention };
import type { WorldTime } from "../types.ts";

export function termHitRate(terms: string[], text: string): number {
  if (terms.length === 0) return 0;
  const hay = text.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (!term) continue;
    if (term.startsWith("/") && term.endsWith("/") && term.length > 2) {
      try {
        const re = new RegExp(term.slice(1, -1), "i");
        if (re.test(text)) hits += 1;
      } catch {
        if (hay.includes(term.toLowerCase())) hits += 1;
      }
    } else if (hay.includes(term.toLowerCase())) {
      hits += 1;
    }
  }
  return hits / terms.length;
}

export function recencyScore(entryT: WorldTime, now: WorldTime, halfLifeDays: number): number {
  const age = ageWorldDays(entryT, now);
  return Math.pow(0.5, age / halfLifeDays);
}

export function salienceBoost(tags: string[], salience?: { tags: string[]; boost: number }[]): number {
  if (!salience?.length || !tags.length) return 0;
  let boost = 0;
  for (const s of salience) {
    if (s.tags.some((t) => tags.includes(t))) boost += s.boost;
  }
  return Math.min(1, Math.max(0, boost));
}

export function scoreMemoryEntry(
  entry: MemoryEntry,
  terms: string[],
  now: WorldTime,
  policy: ResolvedPolicy,
  salience?: { tags: string[]; boost: number }[],
  vectorScore?: number,
  embeddingEnabled?: boolean,
): number {
  const w = {
    term: 0.5,
    recency: 0.2,
    importance: 0.2,
    salience: 0.1,
    vector: 0.3,
    ...policy.memory.weights,
  };
  let termW: number = w.term;
  let recencyW: number = w.recency;
  let importanceW: number = w.importance;
  let salienceW: number = w.salience;
  let vectorW = 0;
  if (embeddingEnabled && vectorScore !== undefined) {
    vectorW = w.vector;
    const rest = termW + recencyW + importanceW + salienceW;
    const scale = rest > 0 ? (1 - vectorW) / rest : 0;
    termW *= scale;
    recencyW *= scale;
    importanceW *= scale;
    salienceW *= scale;
  }
  const term = termHitRate(terms, entry.text);
  if (term <= 0 && (vectorScore === undefined || vectorScore <= 0)) return 0;
  const recency = recencyScore(entry.t, now, policy.memory.recencyHalfLifeDays ?? 7);
  const sal = salienceBoost(entry.tags, salience);
  let score = termW * term + recencyW * recency + importanceW * entry.importance + salienceW * sal;
  if (embeddingEnabled && vectorScore !== undefined) score += vectorW * vectorScore;
  return score;
}

export function passesForgetting(entry: MemoryEntry, now: WorldTime, policy: ResolvedPolicy): boolean {
  const fg = policy.memory.forgetting ?? { enabled: false, tau: 30, threshold: 0.2 };
  if (!fg.enabled) return true;
  const age = ageWorldDays(entry.t, now);
  return forgettingRetention(age, entry.importance, fg.tau) >= fg.threshold;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return Math.max(0, dot / (Math.sqrt(na) * Math.sqrt(nb)));
}

export function scopeActive(
  docScope: string,
  owner: string,
  location?: string,
  sceneId?: string,
): boolean {
  if (docScope === "world") return true;
  if (docScope.startsWith("location:")) return location === docScope.slice("location:".length);
  if (docScope.startsWith("character:")) return owner === docScope.slice("character:".length);
  if (docScope.startsWith("scene:")) return sceneId === docScope.slice("scene:".length);
  return false;
}

export function scopeFilterAllows(scopeFilter: string | undefined, docScope: string, owner: string): boolean {
  if (!scopeFilter || scopeFilter === "all") return true;
  if (scopeFilter === "world") return docScope === "world";
  if (scopeFilter === "location") return docScope.startsWith("location:");
  if (scopeFilter === "character") return docScope.startsWith("character:") && docScope === `character:${owner}`;
  if (scopeFilter === "scene") return docScope.startsWith("scene:");
  return docScope === scopeFilter || docScope.startsWith(`${scopeFilter}:`);
}

export function docMatchesTerms(doc: KnowledgeDoc, terms: string[]): boolean {
  const blob = `${doc.name}\n${doc.description}\n${doc.body}`;
  return termHitRate(terms, blob) > 0;
}

export function toMemoryHit(entry: MemoryEntry, score: number): RetrievalHit {
  return { kind: "memory", id: entry.id, text: entry.text, score, entry };
}

export function toKnowledgeHit(doc: KnowledgeDoc, score: number): RetrievalHit {
  return { kind: "knowledge", id: doc.id, text: doc.body, score, doc };
}
