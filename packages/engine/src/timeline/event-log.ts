import type { StoragePort } from "../ports.ts";
import { appendJsonl, parseJsonlLines, readJsonl, repairJsonlText } from "../store/util.ts";
import type { BranchRef, EngineEvent, EventDraft, EventId } from "../types.ts";
import { formatEventId, parseEventSeq } from "./ids.ts";
import { eventsPath } from "./paths.ts";

export interface BranchHeader {
  kind: "branch.header";
  branch: string;
  parent?: string;
  forkAt?: EventId;
}

export function isBranchHeader(line: unknown): line is BranchHeader {
  return typeof line === "object" && line !== null && (line as BranchHeader).kind === "branch.header";
}

export async function readEventsFile(storage: StoragePort, branch: string): Promise<{ header: BranchHeader; events: EngineEvent[]; raw: string }> {
  const path = eventsPath(branch);
  let raw = (await storage.readText(path)) ?? "";
  const { text, dropped } = repairJsonlText(raw);
  if (dropped) {
    await storage.writeAtomic(path, text);
    raw = text;
  }
  const lines = parseJsonlLines(raw);
  if (lines.length === 0) {
    const header: BranchHeader = { kind: "branch.header", branch };
    return { header, events: [], raw: `${JSON.stringify(header)}\n` };
  }
  const header = lines[0];
  if (!isBranchHeader(header)) throw new Error(`Missing branch.header in ${path}`);
  const events = lines.slice(1) as EngineEvent[];
  return { header, events, raw: text };
}

export async function ensureBranchHeader(storage: StoragePort, branch: string, header?: Partial<BranchHeader>): Promise<BranchHeader> {
  const path = eventsPath(branch);
  if (await storage.exists(path)) {
    const { header: h } = await readEventsFile(storage, branch);
    return h;
  }
  await storage.mkdir(branchDirFromPath(path));
  const h: BranchHeader = { kind: "branch.header", branch, ...header };
  await storage.writeAtomic(path, `${JSON.stringify(h)}\n`);
  return h;
}

function branchDirFromPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : path;
}

export async function appendEventLines(storage: StoragePort, branch: string, events: EngineEvent[]): Promise<void> {
  for (const e of events) {
    await appendJsonl(storage, eventsPath(branch), e, { fsync: true });
  }
}

export function assignEventIds(events: EngineEvent[], startSeq: number): { events: EngineEvent[]; nextSeq: number } {
  let seq = startSeq;
  const out = events.map((e) => {
    seq += 1;
    return { ...e, id: formatEventId(seq) };
  });
  return { events: out, nextSeq: seq };
}

export function truncateEventsAt(events: EngineEvent[], eventId: EventId): EngineEvent[] {
  const target = parseEventSeq(eventId);
  return events.filter((e) => parseEventSeq(e.id) <= target);
}

export function mergeChainEvents(
  chain: BranchRef[],
  load: (branch: string) => Promise<EngineEvent[]>,
): Promise<EngineEvent[]> {
  return mergeChainEventsAsync(chain, load);
}

async function mergeChainEventsAsync(chain: BranchRef[], load: (branch: string) => Promise<EngineEvent[]>): Promise<EngineEvent[]> {
  const merged: EngineEvent[] = [];
  for (let i = 0; i < chain.length; i++) {
    const br = chain[i]!;
    let evs = await load(br.name);
    const child = chain[i + 1];
    if (child?.forkAt) evs = truncateEventsAt(evs, child.forkAt);
    merged.push(...evs);
  }
  return merged;
}

export function draftToEnvelope(
  draft: EventDraft,
  ctx: { id: EventId; t: import("../types.ts").WorldTime; sid: string; scene?: string; turn?: string; source: string; because: string[] },
): EngineEvent {
  const { kind, source: _s, because: _b, t: _t, ...payload } = draft as EventDraft & Record<string, unknown>;
  return {
    kind,
    t: draft.t ?? ctx.t ?? { day: 1, minute: 0 },
    sid: ctx.sid,
    scene: ctx.scene,
    turn: ctx.turn,
    source: draft.source ?? ctx.source,
    because: draft.because ?? ctx.because,
    ...payload,
    id: ctx.id,
  } as EngineEvent;
}
