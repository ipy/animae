import type { InjectedKnowledge } from "../contracts.ts";
import type { Kernel } from "../contracts.ts";
import type { KnowledgeDoc } from "../schema/authored.ts";
import type { CelContext } from "../types.ts";
import { scopeActive, scopeFilterAllows } from "./retrieval.ts";

/** CEL `model` is always defined; callers may pass partial ctx (e.g. tests). */
function celContextWithModel(ctx: CelContext): CelContext {
  const raw = ctx as { model?: { kind?: unknown; tier?: unknown; tags?: unknown } };
  const m = raw.model;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    return {
      ...ctx,
      model: {
        kind: typeof m.kind === "string" ? m.kind : "",
        ...(typeof m.tier === "string" ? { tier: m.tier } : {}),
        tags: Array.isArray(m.tags) ? [...m.tags] : [],
      },
    };
  }
  return { ...ctx, model: { kind: "", tags: [] } };
}

const warnedWhenFailures = new WeakMap<Kernel, Set<string>>();

/**
 * A `when` condition that cannot be evaluated (an unguarded optional key, a typo) is an authoring defect, not a
 * reason to fail the player's turn: the document is skipped and the defect is reported once per document.
 */
function whenMatches(k: Kernel, doc: KnowledgeDoc, ctx: CelContext): boolean {
  try {
    return k.rules.cel.bool(doc.when ?? "false", ctx);
  } catch (err) {
    const warned = warnedWhenFailures.get(k) ?? new Set<string>();
    warnedWhenFailures.set(k, warned);
    if (!warned.has(doc.id)) {
      warned.add(doc.id);
      const reason = err instanceof Error ? err.message : String(err);
      k.warn("KNOWLEDGE_WHEN_FAILED", `knowledge ${doc.id} \`when\` condition failed: ${reason}`, { id: doc.id, path: doc.path });
    }
    return false;
  }
}

export function gatherKnowledge(
  k: Kernel,
  q: { owner: string; location?: string; sceneId?: string; ctx: import("../types.ts").CelContext; scopeFilter?: string },
): InjectedKnowledge {
  const indexMax = k.policy.memory.indexMax;
  const docs = k.catalog.knowledge();
  const ownerDocs = docs.filter((d) => {
    if (d.owner && d.owner !== q.owner && d.scope.startsWith("character:")) return false;
    if (d.scope.startsWith("character:") && d.scope !== `character:${q.owner}`) return false;
    if (!scopeActive(d.scope, q.owner, q.location, q.sceneId)) return false;
    if (!scopeFilterAllows(q.scopeFilter, d.scope, q.owner)) return false;
    return true;
  });

  const evalCtx = celContextWithModel(q.ctx);
  const always: KnowledgeDoc[] = [];
  const when: KnowledgeDoc[] = [];
  const onDemandCandidates: KnowledgeDoc[] = [];

  for (const doc of ownerDocs) {
    if (doc.inject === "always") always.push(doc);
    else if (doc.inject === "when") {
      if (whenMatches(k, doc, evalCtx)) when.push(doc);
    } else onDemandCandidates.push(doc);
  }

  onDemandCandidates.sort((a, b) => b.priority - a.priority);
  const index = onDemandCandidates.slice(0, indexMax).map((d) => ({
    name: d.name,
    description: d.description,
    id: d.id,
  }));

  return { always, when, index };
}
