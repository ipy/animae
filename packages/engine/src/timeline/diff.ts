import type { TimelineDeps } from "./deps.ts";
import type { TimelineDiff } from "../contracts.ts";
import type { BranchName, BranchRef } from "../types.ts";
import type { EngineState } from "../state.ts";
import { mergeChainEvents, readEventsFile } from "./event-log.ts";
import { parseEventSeq } from "./ids.ts";
import { rebuildState } from "./snapshots.ts";

export async function diffBranches(
  deps: TimelineDeps,
  a: BranchRef | BranchName,
  b: BranchRef | BranchName,
): Promise<TimelineDiff> {
  const nameA = typeof a === "string" ? a : a.name;
  const nameB = typeof b === "string" ? b : b.name;
  const chainA = await buildChain(deps, nameA);
  const chainB = await buildChain(deps, nameB);
  const evA = await mergeChainEvents(chainA, async (bn) => (await readEventsFile(deps.storage, bn)).events);
  const evB = await mergeChainEvents(chainB, async (bn) => (await readEventsFile(deps.storage, bn)).events);
  const stateA = await rebuildState(deps.authored(), deps.policy(), evA);
  const stateB = await rebuildState(deps.authored(), deps.policy(), evB);
  const idsA = new Set(evA.map((e) => e.id));
  const idsB = new Set(evB.map((e) => e.id));
  const onlyA = evA.filter((e) => !idsB.has(e.id)).map((e) => e.id);
  const onlyB = evB.filter((e) => !idsA.has(e.id)).map((e) => e.id);
  let commonUntil: string | undefined;
  for (const e of evA) {
    if (idsB.has(e.id)) commonUntil = e.id;
  }
  return { state: flattenStateDiff(stateA, stateB), events: { onlyA, onlyB, commonUntil } };
}

async function buildChain(deps: TimelineDeps, current: string): Promise<BranchRef[]> {
  const dirs = await deps.storage.list("timelines");
  const headers: { branch: string; parent?: string; forkAt?: string }[] = [];
  for (const d of dirs) {
    if (!d.endsWith("/")) continue;
    const name = d.slice(0, -1);
    const { header } = await readEventsFile(deps.storage, name);
    headers.push(header);
  }
  const byName = new Map(headers.map((h) => [h.branch, h]));
  const chain: BranchRef[] = [];
  let name: string | undefined = current;
  while (name) {
    const h = byName.get(name);
    chain.unshift({ name, parent: h?.parent, forkAt: h?.forkAt });
    name = h?.parent;
  }
  return chain;
}

function flattenStateDiff(a: EngineState, b: EngineState): { path: string; a: unknown; b: unknown }[] {
  const out: { path: string; a: unknown; b: unknown }[] = [];
  walk("", a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>, out);
  return out;
}

function walk(prefix: string, a: Record<string, unknown>, b: Record<string, unknown>, out: { path: string; a: unknown; b: unknown }[]): void {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const path = prefix ? `${prefix}.${k}` : k;
    const va = a[k];
    const vb = b[k];
    if (va !== null && vb !== null && typeof va === "object" && typeof vb === "object" && !Array.isArray(va) && !Array.isArray(vb)) {
      walk(path, va as Record<string, unknown>, vb as Record<string, unknown>, out);
    } else if (JSON.stringify(va) !== JSON.stringify(vb)) {
      out.push({ path, a: va, b: vb });
    }
  }
}
