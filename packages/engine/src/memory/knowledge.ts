import type { InjectedKnowledge } from "../contracts.ts";
import type { Kernel } from "../contracts.ts";
import type { KnowledgeDoc } from "../schema/authored.ts";
import type { CelContext } from "../types.ts";
import { scopeActive, scopeFilterAllows } from "./retrieval.ts";

/** CEL `model` is always defined; callers may pass partial ctx (e.g. tests). */
function celContextWithModel(ctx: CelContext): CelContext {
  const raw = ctx as { model?: { slot?: unknown; tags?: unknown } };
  const m = raw.model;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    return {
      ...ctx,
      model: {
        slot: typeof m.slot === "string" ? m.slot : "",
        tags: Array.isArray(m.tags) ? [...m.tags] : [],
      },
    };
  }
  return { ...ctx, model: { slot: "", tags: [] } };
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
      const whenExpr = doc.when ?? "false";
      if (k.rules.cel.bool(whenExpr, evalCtx)) when.push(doc);
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
