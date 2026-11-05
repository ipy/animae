import type { Kernel, MemoryEntry, MemoryService, RetrievalHit } from "../contracts.ts";
import type { CharacterId, EventDraft, SceneId } from "../types.ts";
import { bindDistort } from "./distortion.ts";
import { gatherKnowledge } from "./knowledge.ts";
import { formatSummaryMarkdown, runReflectionForOwner } from "./reflection.ts";
import {
  cosineSimilarity,
  docMatchesTerms,
  passesForgetting,
  recencyScore,
  salienceBoost,
  scoreMemoryEntry,
  scopeActive,
  scopeFilterAllows,
  termHitRate,
  toKnowledgeHit,
  toMemoryHit,
} from "./retrieval.ts";
import { ageWorldDays, deepCopy, forgettingRetention, memoryJsonlPath, summaryMdPath } from "./util.ts";

type StoredLine = MemoryEntry & { _seq?: number };

interface MemoryInternal {
  cache: Map<string, MemoryEntry[]>;
  vectorCache: Map<string, Float32Array[]>;
  deferredReflect: { sceneId: SceneId; participants: CharacterId[] }[];
  propagated: Set<string>;
}

const internals = new WeakMap<Kernel, MemoryInternal>();

function internal(k: Kernel): MemoryInternal {
  let i = internals.get(k);
  if (!i) {
    i = { cache: new Map(), vectorCache: new Map(), deferredReflect: [], propagated: new Set() };
    internals.set(k, i);
  }
  return i;
}

function cacheKey(branch: string, owner: string): string {
  return `${branch}|${owner}`;
}

function stripLine(row: StoredLine): MemoryEntry {
  const { _seq, ...entry } = row;
  return entry as MemoryEntry;
}

/** Introspect sync hook: returns the in-memory cache for `(branch, owner)` when populated. */
export function memoryCacheFor(k: Kernel, owner: CharacterId): MemoryEntry[] {
  return memorySyncList(k, owner);
}

/** Sync list for introspect: last loaded list per owner on current branch (updated on write/list/retrieve). */
export function memorySyncList(k: Kernel, owner: CharacterId): MemoryEntry[] {
  const branch = k.timeline.branch().name;
  const key = cacheKey(branch, owner);
  const hit = internal(k).cache.get(key);
  if (hit) return deepCopy(hit);
  return [];
}

export function createMemoryService(k: Kernel): MemoryService {
  const distort = bindDistort(k);

  async function loadEntries(owner: CharacterId): Promise<MemoryEntry[]> {
    const branch = k.timeline.branch().name;
    const key = cacheKey(branch, owner);
    const cached = internal(k).cache.get(key);
    if (cached) return cached;
    const rows = await k.timeline.artifacts.readJsonl<StoredLine>(memoryJsonlPath(owner));
    const entries = rows.map(stripLine);
    internal(k).cache.set(key, entries);
    return entries;
  }

  /**
   * Keeps the per-owner cache in step with the artifact after an append. A loaded list is extended instead of dropped:
   * the sync introspection hooks (`explain`) read it, and a cold cache would hide the memory text of earlier turns.
   */
  function noteAppended(owner: CharacterId, entry: MemoryEntry): void {
    const branch = k.timeline.branch().name;
    internal(k).cache.get(cacheKey(branch, owner))?.push(entry);
    internal(k).vectorCache.clear();
  }

  const service: MemoryService = {
    async write(owner, e) {
      const ch = k.timeline.state().characters[owner];
      if (!ch) return undefined;
      if (ch.lod === "extra") return undefined;

      const branch = k.timeline.branch().name;
      const seq = k.timeline.state().seq + 1;
      const idx = k.timeline.state().memoryIndex[owner]?.count ?? 0;
      const id = e.id ?? `mem_${String(seq).padStart(4, "0")}_${idx + 1}`;
      const entry: MemoryEntry = {
        ...e,
        id,
        branch,
        tags: e.tags ?? [],
        claims: e.claims ?? [],
        importance: e.importance ?? 0.5,
        valence: e.valence ?? 0,
      };
      const path = memoryJsonlPath(owner);
      await k.timeline.artifacts.appendJsonl(path, entry);
      noteAppended(owner, entry);
      await k.emit([
        {
          kind: "memory.written",
          source: "memory",
          owner,
          memoryId: id,
          importance: entry.importance,
          src: entry.src,
          path,
        } as EventDraft,
      ]);
      return entry;
    },

    async list(owner, opts) {
      const now = k.timeline.now();
      const entries = await loadEntries(owner);
      const fg = k.policy.memory.forgetting ?? { enabled: false, tau: 30, threshold: 0.2 };
      const filtered = entries.filter((e) => {
        if (opts?.includeForgotten) return true;
        if (!fg.enabled) return true;
        const age = ageWorldDays(e.t, now);
        return forgettingRetention(age, e.importance, fg.tau) >= fg.threshold;
      });
      internal(k).cache.set(cacheKey(k.timeline.branch().name, owner), entries);
      return deepCopy(filtered);
    },

    knowledge(q) {
      return gatherKnowledge(k, q);
    },

    readDoc(id) {
      const doc = k.catalog.knowledge().find((d) => d.id === id);
      if (!doc) return undefined;
      return { name: doc.name, body: doc.body };
    },

    async retrieve(q) {
      const policy = k.policy;
      const limit = q.limit ?? policy.memory.k;
      const entries = (await loadEntries(q.owner)).filter((e) => {
        if (q.suppressTags?.length && e.tags.some((t) => q.suppressTags!.includes(t))) return false;
        if (!passesForgetting(e, q.now, policy)) return false;
        if (q.tags?.length && !q.tags.some((t) => e.tags.includes(t))) return false;
        return true;
      });

      const location = q.location ?? k.timeline.state().characters[q.owner]?.location ?? k.timeline.state().playerLocation;
      const sceneId = k.timeline.state().scene?.id;
      const docs = k.catalog.knowledge().filter((d) => {
        if (d.owner && d.owner !== q.owner && d.scope.startsWith("character:")) return false;
        if (d.scope.startsWith("character:") && d.scope !== `character:${q.owner}`) return false;
        if (!scopeActive(d.scope, q.owner, location, sceneId)) return false;
        if (!scopeFilterAllows(q.scope, d.scope, q.owner)) return false;
        return true;
      });

      const hits: RetrievalHit[] = [];
      const terms = q.terms.filter(Boolean);
      const embeddingOn = Boolean(k.embedding);

      let queryVec: Float32Array | undefined;
      if (embeddingOn && k.embedding && terms.length > 0) {
        const vecs = await k.embedding.embed([terms.join(" ")]);
        queryVec = vecs[0];
      }

      const branch = k.timeline.branch().name;
      const vecKey = `${branch}|${q.owner}|${terms.join("\0")}`;

      for (const entry of entries) {
        const term = termHitRate(terms, entry.text);
        if (term <= 0 && !embeddingOn) continue;
        let vectorScore: number | undefined;
        if (embeddingOn && k.embedding && queryVec) {
          const texts = [entry.text];
          let vecs = internal(k).vectorCache.get(`${branch}|mem|${entry.id}`);
          if (!vecs) {
            vecs = await k.embedding.embed(texts);
            internal(k).vectorCache.set(`${branch}|mem|${entry.id}`, vecs);
          }
          vectorScore = cosineSimilarity(queryVec, vecs[0]!);
          if (term <= 0 && vectorScore <= 0.01) continue;
        } else if (term <= 0) continue;

        const score = scoreMemoryEntry(entry, terms, q.now, policy, q.salience, vectorScore, embeddingOn);
        if (score > 0) hits.push(toMemoryHit(entry, score, q.owner));
      }

      for (const doc of docs) {
        const inject = doc.inject;
        const blob = `${doc.name}\n${doc.description}\n${doc.body}`;
        const term = termHitRate(terms, blob);
        let vectorScore: number | undefined;
        if (embeddingOn && k.embedding && queryVec) {
          let vecs = internal(k).vectorCache.get(`${branch}|doc|${doc.id}`);
          if (!vecs) {
            vecs = await k.embedding.embed([blob]);
            internal(k).vectorCache.set(`${branch}|doc|${doc.id}`, vecs);
          }
          vectorScore = cosineSimilarity(queryVec, vecs[0]!);
          if (inject === "on-demand" && term <= 0 && vectorScore <= 0.01) continue;
        } else if (inject === "on-demand" && term <= 0) continue;
        else if (inject !== "on-demand" && term <= 0) continue;
        if (inject === "on-demand" && !docMatchesTerms(doc, terms)) continue;

        const pseudoImportance = 0.4 + Math.min(0.5, doc.priority / 100);
        const score = scoreMemoryEntry(
          {
            id: doc.id,
            t: q.now,
            kind: "semantic",
            text: blob,
            tags: doc.tags,
            claims: [],
            importance: pseudoImportance,
            valence: 0,
            branch,
          },
          terms,
          q.now,
          policy,
          q.salience,
          vectorScore,
          embeddingOn,
        );
        if (score > 0) hits.push(toKnowledgeHit(doc, score, q.owner));
      }

      void vecKey;
      hits.sort((a, b) => b.score - a.score);
      const top = hits.slice(0, limit);
      internal(k).cache.set(cacheKey(branch, q.owner), await loadEntries(q.owner));
      return deepCopy(top);
    },

    distort,

    async propagateTick(when: "day" | "scene_end" = "day") {
      const cfg = k.policy.memory.propagation ?? { enabled: false, onTick: "day" as const, distortionPerHop: 1 };
      if (!cfg.enabled) return [];
      const onTick = cfg.onTick ?? "day";
      if (onTick !== when) return [];
      const events: EventDraft[] = [];
      const state = k.timeline.state();
      const now = k.timeline.now();

      for (const [ownerId, ch] of Object.entries(state.characters)) {
        const def = k.catalog.character(ownerId);
        if (!def) continue;
        const entries = await loadEntries(ownerId);
        for (const entry of entries) {
          if (!entry.shareable && !entry.tags.includes("shareable")) continue;
          for (const rel of def.relations) {
            const other = rel.to;
            if (!other || other === ownerId) continue;
            const pairKey = `${entry.id}|${other}`;
            if (internal(k).propagated.has(pairKey)) continue;
            const already = (await loadEntries(other)).some((e) => e.carriedFrom === entry.id);
            if (already) {
              internal(k).propagated.add(pairKey);
              continue;
            }
            const ctx = k.celContext({ self: ownerId as CharacterId, other: other as CharacterId });
            if (!k.rules.cel.bool(rel.share, ctx)) continue;

            const copy = await service.write(other as CharacterId, {
              kind: entry.kind,
              t: now,
              text: entry.text,
              tags: [...entry.tags, "propagated"],
              claims: entry.claims.map((c) => ({ ...c })),
              importance: entry.importance * 0.9,
              valence: entry.valence,
              shareable: false,
              hops: (entry.hops ?? 0) + 1,
              carriedFrom: entry.id,
              src: entry.src,
            });
            if (!copy) continue;
            internal(k).propagated.add(pairKey);
            events.push({
              kind: "memory.propagated",
              source: "memory",
              from: ownerId,
              to: other,
              memoryId: entry.id,
              newMemoryId: copy.id,
              hops: copy.hops,
            } as EventDraft);
          }
        }
        void ch;
      }
      if (events.length) return k.emit(events);
      return [];
    },

    async reflect(sceneId, opts) {
      if (k.policy.reflection?.enabled === false) return [];
      const participants = opts?.participants ?? k.timeline.state().scene?.participants ?? [];
      if (opts?.defer) {
        internal(k).deferredReflect.push({ sceneId, participants: [...participants] });
        return [];
      }
      const principals = participants.filter((id) => {
        const lod = k.timeline.state().characters[id]?.lod ?? k.catalog.character(id)?.card.lod;
        return lod === "principal";
      });
      const writeSummaryFile = async (owner: CharacterId, text: string, summaryId: string) => {
        const md = formatSummaryMarkdown(summaryId, text, owner, sceneId);
        await k.timeline.artifacts.writeText(summaryMdPath(owner, summaryId), md);
        await service.write(owner, {
          kind: "summary",
          t: k.timeline.now(),
          text,
          tags: ["reflection", "summary"],
          claims: [],
          importance: 0.6,
          valence: 0,
        });
      };
      const results: { owner: CharacterId; accepted: boolean }[] = [];
      for (const owner of principals) {
        results.push(await runReflectionForOwner(k, sceneId, owner, writeSummaryFile));
      }
      return results;
    },

    async flushDeferred() {
      const queue = [...internal(k).deferredReflect];
      internal(k).deferredReflect = [];
      for (const { sceneId, participants } of queue) {
        await service.reflect(sceneId, { defer: false, participants });
      }
    },

    async summaryFor(owner) {
      const entries = await service.list(owner);
      const summaries = entries.filter((e) => e.kind === "summary" || e.tags.includes("summary"));
      const top = entries
        .filter((e) => e.kind !== "summary")
        .sort((a, b) => b.importance - a.importance || b.t.day - a.t.day)
        .slice(0, 5);
      const parts: string[] = [];
      if (summaries.length) parts.push(summaries.map((s) => s.text).join(" "));
      if (top.length) parts.push(top.map((m) => m.text).join(" "));
      return parts.join("\n").trim() || "(no long-term memories yet)";
    },
  };

  return service;
}
