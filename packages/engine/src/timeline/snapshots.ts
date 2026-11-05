import type { StoragePort } from "../ports.ts";
import type { EngineState } from "../state.ts";
import type { EngineEvent, EventId } from "../types.ts";
import { parseEventSeq } from "./ids.ts";
import { snapshotPath, snapshotsDir } from "./paths.ts";
import { createReducer } from "./reducer.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import type { Authored } from "../schema/authored.ts";
import { initialState } from "./initial-state.ts";

export const SNAPSHOT_EVERY = 200;

export interface SnapshotFile {
  eventId: EventId;
  seq: number;
  state: EngineState;
}

export async function writeSnapshot(storage: StoragePort, branch: string, eventId: EventId, state: EngineState): Promise<void> {
  await storage.mkdir(snapshotsDir(branch));
  const file: SnapshotFile = { eventId, seq: state.seq, state };
  await storage.writeAtomic(snapshotPath(branch, eventId), JSON.stringify(file, null, 2));
}

export async function loadLatestSnapshot(
  storage: StoragePort,
  branch: string,
): Promise<{ snap: SnapshotFile; path: string } | undefined> {
  const files = (await storage.listFiles(snapshotsDir(branch))).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return undefined;
  let best: { snap: SnapshotFile; path: string } | undefined;
  for (const f of files) {
    const text = await storage.readText(f);
    if (!text) continue;
    const snap = JSON.parse(text) as SnapshotFile;
    if (!best || snap.seq > best.snap.seq) best = { snap, path: f };
  }
  return best;
}

export async function deleteSnapshotsAfter(storage: StoragePort, branch: string, seq: number): Promise<void> {
  const files = await storage.listFiles(snapshotsDir(branch));
  for (const f of files) {
    const text = await storage.readText(f);
    if (!text) continue;
    const snap = JSON.parse(text) as SnapshotFile;
    if (snap.seq > seq) await storage.remove(f);
  }
}

export async function rebuildState(
  authored: Authored,
  policy: ResolvedPolicy,
  events: EngineEvent[],
  fromSnapshot?: SnapshotFile,
): Promise<EngineState> {
  let state = fromSnapshot ? structuredClone(fromSnapshot.state) : initialState(authored, policy);
  const reduce = createReducer(() => policy);
  let startIdx = 0;
  if (fromSnapshot !== undefined) {
    const tailAt = events.findIndex((e) => parseEventSeq(e.id) > fromSnapshot.seq);
    startIdx = tailAt < 0 ? events.length : tailAt;
  }
  for (let i = startIdx; i < events.length; i++) {
    state = reduce(state, events[i]!);
  }
  return state;
}

export function shouldSnapshot(state: EngineState, reason: "count" | "scene_end"): boolean {
  if (reason === "scene_end") return true;
  return state.seq > 0 && state.seq % SNAPSHOT_EVERY === 0;
}
