import type { CelEngine } from "../contracts.ts";
import type { MemoryEntry } from "../contracts.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import type { StoragePort } from "../ports.ts";
import type { EngineState } from "../state.ts";
import type { BranchRef, CelContext, EngineEvent, EventDraft, EventId } from "../types.ts";
import { parseJsonlLines } from "../store/util.ts";
import { parseEventSeq } from "./ids.ts";
import { artifactPath } from "./paths.ts";
import { memoryJsonlPath } from "../memory/util.ts";

export interface CarryResult {
  drafts: EventDraft[];
  artifactLines: { path: string; obj: unknown }[];
}

type StoredMemory = MemoryEntry & { _seq?: number; carriedFrom?: string };

export async function collectCarry(
  storage: StoragePort,
  policy: ResolvedPolicy,
  cel: CelEngine,
  parentBranch: string,
  forkAt: EventId,
  parentEvents: EngineEvent[],
  parentState: EngineState,
): Promise<CarryResult> {
  const rules = policy.timeline.carry ?? [];
  const artifactLines: { path: string; obj: unknown }[] = [];
  if (rules.length === 0) {
    return { drafts: [{ kind: "carry.applied", items: [] } as EventDraft], artifactLines };
  }

  const forkSeq = parseEventSeq(forkAt);
  const afterFork = parentEvents.filter((e) => parseEventSeq(e.id) > forkSeq);
  const items: { kind: string; detail: Record<string, unknown> }[] = [];
  const drafts: EventDraft[] = [];
  const carriedMemoryIds = new Set<string>();

  for (const rule of rules) {
    const charFilter = rule.characters === "*" ? null : new Set(rule.characters);
    for (const kind of rule.kinds) {
      if (kind === "world_var") {
        for (const e of afterFork) {
          if (e.kind !== "world.var_set") continue;
          const p = e as unknown as { path: string; value: unknown };
          const ctx = minimalCel(parentState, cel);
          if (!cel.bool(rule.when, ctx)) continue;
          drafts.push({
            kind: "world.var_set",
            path: p.path,
            value: p.value,
            carriedFrom: `${parentBranch}:${e.id}`,
          } as EventDraft);
          items.push({ kind: "world_var", detail: { path: p.path, from: `${parentBranch}:${e.id}` } });
        }
      } else if (kind === "track") {
        for (const e of afterFork) {
          if (e.kind !== "track.delta") continue;
          const p = e as unknown as { owner: string; target?: string; track: string; after: number; reason?: string };
          if (p.reason === "carry") continue;
          if (charFilter && !charFilter.has(p.owner)) continue;
          const ctx = minimalCel(parentState, cel, p.owner);
          if (!cel.bool(rule.when, ctx)) continue;
          drafts.push({
            kind: "track.delta",
            owner: p.owner,
            target: p.target,
            track: p.track,
            delta: 0,
            before: p.after,
            after: p.after,
            reason: "carry",
            carriedFrom: `${parentBranch}:${e.id}`,
          } as EventDraft);
          items.push({ kind: "track", detail: { owner: p.owner, track: p.track, from: `${parentBranch}:${e.id}` } });
        }
      } else if (kind === "memory") {
        const owners = charFilter ? [...charFilter] : Object.keys(parentState.characters);
        for (const owner of owners) {
          const path = artifactPath(parentBranch, memoryJsonlPath(owner));
          const text = await storage.readText(path);
          if (!text) continue;
          const lines = parseJsonlLines(text) as StoredMemory[];
          for (const row of lines) {
            if ((row._seq ?? 0) <= forkSeq) continue;
            if (carriedMemoryIds.has(row.id)) continue;
            if (rule.tags.length > 0 && !row.tags.some((t) => rule.tags.includes(t))) continue;
            const ctx = minimalCel(parentState, cel, owner);
            if (!cel.bool(rule.when, ctx)) continue;
            const srcEvent =
              afterFork.find((e) => e.kind === "memory.written" && (e as { memoryId?: string; owner?: string }).memoryId === row.id) ??
              afterFork.find((e) => e.kind === "memory.written" && (e as { owner?: string }).owner === owner);
            const carriedFrom = `${parentBranch}:${srcEvent?.id ?? forkAt}`;
            const copy = { ...row, carriedFrom, branch: parentBranch };
            artifactLines.push({ path: memoryJsonlPath(owner), obj: copy });
            carriedMemoryIds.add(row.id);
            drafts.push({
              kind: "memory.written",
              owner,
              memoryId: row.id,
              importance: row.importance,
              path: memoryJsonlPath(owner),
              carriedFrom,
            } as EventDraft);
            items.push({ kind: "memory", detail: { id: row.id, owner, from: carriedFrom } });
          }
        }
      }
    }
  }

  drafts.push({ kind: "carry.applied", items } as EventDraft);
  return { drafts, artifactLines };
}

function minimalCel(state: EngineState, _cel: CelEngine, selfId?: string): CelContext {
  return {
    world: { vars: state.vars, time: state.time },
    self: selfId ? { id: selfId } : null,
  };
}

export function buildChainRefs(storageBranches: BranchHeaderLite[], current: string): BranchRef[] {
  const byName = new Map(storageBranches.map((b) => [b.branch, b]));
  const chain: BranchRef[] = [];
  let name: string | undefined = current;
  while (name) {
    const h = byName.get(name);
    chain.unshift({ name, parent: h?.parent, forkAt: h?.forkAt });
    name = h?.parent;
  }
  return chain;
}

export interface BranchHeaderLite {
  branch: string;
  parent?: string;
  forkAt?: EventId;
}
