import type { AppendCtx, TimelineStore } from "../contracts.ts";
import type { Authored } from "../schema/authored.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import type { EngineState } from "../state.ts";
import { stringifyYaml, readYamlFile } from "../store/util.ts";
import type { StoragePort } from "../ports.ts";
import type { ModelMode } from "../ports.ts";
import {
  AnimaeError,
  type BranchName,
  type BranchRef,
  type EngineEvent,
  type EventDraft,
  type EventId,
  type SaveSlot,
  type TurnId,
  type WorldTime,
} from "../types.ts";
import { createArtifactStore, removeArtifactPaths } from "./artifacts.ts";
import { collectCarry, type BranchHeaderLite } from "./carry.ts";
import {
  appendEventLines,
  draftToEnvelope,
  ensureBranchHeader,
  mergeChainEvents,
  readEventsFile,
  truncateEventsAt,
} from "./event-log.ts";
import { formatEventId, nextBranchName, parseEventSeq } from "./ids.ts";
import { initialState } from "./initial-state.ts";
import { exportBranchToFile, importBranchFromFile } from "./export-import.ts";
import { HEAD_FILE, SAVES_FILE, branchDir, entitiesPath, eventsPath } from "./paths.ts";
import { lookupRecording, readRecordings } from "./recordings.ts";
import { createReducer } from "./reducer.ts";
import { createRng } from "./rng.ts";
import { deleteSnapshotsAfter, loadLatestSnapshot, rebuildState, shouldSnapshot, writeSnapshot } from "./snapshots.ts";
import type { RecordingStore } from "../contracts.ts";
import type { ArtifactStore } from "../contracts.ts";
import { eventMatches } from "./replay.ts";
import { purgeEventsAndArtifacts } from "./purge.ts";
import { diffBranches } from "./diff.ts";

import type { TimelineDeps } from "./deps.ts";

export type { TimelineDeps } from "./deps.ts";

const DEFAULT_BRANCH = "main";

export function createTimeline(deps: TimelineDeps): TimelineStore {
  let branch = DEFAULT_BRANCH;
  let state: EngineState = initialState(deps.authored(), deps.policy());
  let chain: BranchRef[] = [{ name: DEFAULT_BRANCH }];
  let eventsMem: EngineEvent[] = [];
  let appendQueue: Promise<void> = Promise.resolve();
  const subscribers = new Map<string, Set<(e: EngineEvent) => void>>();
  let recordingsCache = new Map<string, Map<string, unknown>>();
  let closed = true;

  const reduce = () => createReducer(() => deps.policy());

  const getRootBranch = (): string => chain[0]?.name ?? branch;

  const artifacts: ArtifactStore = createArtifactStore(
    deps.storage,
    () => chain,
    () => state.seq,
    () => branch,
  );

  const recordings: RecordingStore = {
    mode: deps.modelMode,
    lookup(key) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const m = recordingsCache.get(chain[i]!.name);
        if (m?.has(key)) return m.get(key);
      }
      return undefined;
    },
    async record(key, response) {
      if (deps.modelMode !== "record") return;
      const { appendJsonl } = await import("../store/util.ts");
      await appendJsonl(deps.storage, `${branchDir(branch)}/recordings.jsonl`, { key, response }, { fsync: true });
      let m = recordingsCache.get(branch);
      if (!m) {
        m = new Map();
        recordingsCache.set(branch, m);
      }
      m.set(key, response);
    },
  };

  async function refreshRecordingsCache(): Promise<void> {
    recordingsCache = new Map();
    for (const br of chain) {
      const lines = await readRecordings(deps.storage, br.name);
      const m = new Map<string, unknown>();
      for (const line of lines) m.set(line.key, line.response);
      recordingsCache.set(br.name, m);
    }
  }

  async function loadAllBranchHeaders(): Promise<BranchHeaderLite[]> {
    const dirs = await deps.storage.list("timelines");
    const out: BranchHeaderLite[] = [];
    for (const d of dirs) {
      if (!d.endsWith("/")) continue;
      const name = d.slice(0, -1);
      if (name === "timelines") continue;
      const rel = name.includes("/") ? name.split("/").pop()! : name;
      try {
        const { header } = await readEventsFile(deps.storage, rel);
        out.push({ branch: header.branch, parent: header.parent, forkAt: header.forkAt });
      } catch {
        /* skip */
      }
    }
    return out;
  }

  async function rebuildChainFromHeaders(current: string): Promise<BranchRef[]> {
    const headers = await loadAllBranchHeaders();
    const byName = new Map(headers.map((h) => [h.branch, h]));
    const c: BranchRef[] = [];
    let name: string | undefined = current;
    while (name) {
      const h = byName.get(name);
      c.unshift({ name, parent: h?.parent, forkAt: h?.forkAt });
      name = h?.parent;
    }
    return c.length ? c : [{ name: current }];
  }

  async function reloadEventsAndState(): Promise<void> {
    chain = await rebuildChainFromHeaders(branch);
    eventsMem = await mergeChainEvents(chain, async (b) => (await readEventsFile(deps.storage, b)).events);
    const snapBranch = branch;
    const latest = await loadLatestSnapshot(deps.storage, snapBranch);
    let tail = eventsMem;
    if (latest) {
      const snapSeq = latest.snap.seq;
      tail = eventsMem.filter((e) => parseEventSeq(e.id) > snapSeq);
      if (latest.snap.state.seq !== snapSeq) {
        /* snapshot seq mismatch — replay tail from snapshot anyway */
      }
      state = structuredClone(latest.snap.state);
      for (const e of tail) state = reduce()(state, e);
    } else {
      state = await rebuildState(deps.authored(), deps.policy(), eventsMem);
    }
    await refreshRecordingsCache();
  }

  async function persistHead(): Promise<void> {
    await deps.storage.writeAtomic(HEAD_FILE, branch);
  }

  async function runAppend(drafts: EventDraft[], ctx: AppendCtx = {}): Promise<EngineEvent[]> {
    const policy = deps.policy();
    const persisted: EngineEvent[] = [];
    let seq = state.seq;
    for (const draft of drafts) {
      seq += 1;
      const id = formatEventId(seq);
      const env = draftToEnvelope(draft, {
        id,
        t: draft.t ?? state.time,
        sid: deps.sessionId,
        scene: ctx.scene ?? state.scene?.id,
        turn: ctx.turn,
        source: ctx.source ?? "engine",
        because: ctx.because ?? [],
      });
      await appendEventLines(deps.storage, branch, [env]);
      state = reduce()(state, env);
      eventsMem.push(env);
      persisted.push(env);
      notify(env);
      if (env.kind === "entity.created") {
        const p = env as unknown as EngineEvent<{ entity: { kind: string; id: string }; data: unknown }>;
        await deps.storage.writeAtomic(
          entitiesPath(branch, p.entity.kind, p.entity.id),
          JSON.stringify(p.data, null, 2),
        );
      }
    }
    return persisted;
  }

  function notify(e: EngineEvent): void {
    for (const [pattern, handlers] of subscribers) {
      if (!eventMatches(pattern, e.kind)) continue;
      for (const h of handlers) {
        try {
          h(e);
        } catch (err) {
          void appendInternal([
            {
              kind: "config.warning",
              code: "subscriber",
              message: err instanceof Error ? err.message : String(err),
            },
          ]);
        }
      }
    }
  }

  async function appendInternal(drafts: EventDraft[]): Promise<EngineEvent[]> {
    return runAppend(drafts);
  }

  return {
    sessionId: deps.sessionId,
    artifacts,
    recordings,
    async open() {
      closed = false;
      await deps.storage.acquireLock().catch(() => undefined);
      const head = await deps.storage.readText(HEAD_FILE);
      branch = head?.trim() || DEFAULT_BRANCH;
      await ensureBranchHeader(deps.storage, branch);
      await reloadEventsAndState();
    },
    async close() {
      if (closed) return;
      closed = true;
      await appendQueue;
      subscribers.clear();
      await deps.storage.releaseLock().catch(() => undefined);
    },
    branch() {
      return { name: branch, parent: chain[0]?.name !== branch ? chain[chain.length - 2]?.name : undefined, forkAt: chain[chain.length - 1]?.forkAt };
    },
    chain() {
      return [...chain];
    },
    state() {
      return state;
    },
    now() {
      return state.time;
    },
    append(drafts, ctx) {
      const job = appendQueue.then(() => runAppend(drafts, ctx));
      appendQueue = job.then(() => undefined, () => undefined);
      return job;
    },
    events() {
      return eventsMem;
    },
    eventsByTurn(turn: TurnId) {
      return eventsMem.filter((e) => e.turn === turn);
    },
    on(pattern, h) {
      let set = subscribers.get(pattern);
      if (!set) {
        set = new Set();
        subscribers.set(pattern, set);
      }
      set.add(h);
      return () => set!.delete(h);
    },
    rng(key) {
      return createRng(deps.seed, getRootBranch(), key);
    },
    async save(label) {
      const slot: SaveSlot = {
        label: label ?? `save_${Date.now()}`,
        branch,
        eventId: eventsMem.at(-1)?.id ?? formatEventId(0),
        createdAt: (deps.now?.() ?? new Date()).toISOString(),
        worldTime: { ...state.time },
      };
      const prev = (await readYamlFile<{ slots?: SaveSlot[] }>(deps.storage, SAVES_FILE)) ?? { slots: [] };
      const slots = [...(prev.slots ?? []).filter((s) => s.label !== slot.label), slot];
      await deps.storage.writeAtomic(SAVES_FILE, stringifyYaml({ slots }));
      return slot;
    },
    async saves() {
      const doc = await readYamlFile<{ slots?: SaveSlot[] }>(deps.storage, SAVES_FILE);
      return doc?.slots ?? [];
    },
    async load(slotRef) {
      const slots = await this.saves();
      const slot = typeof slotRef === "string" ? slots.find((s) => s.label === slotRef) : slotRef;
      if (!slot) throw new AnimaeError("SAVE_NOT_FOUND", `Save slot not found`);
      const headEvent = eventsMem.at(-1)?.id;
      if (slot.branch === branch && slot.eventId === headEvent) return;
      if (slot.branch === branch && slot.eventId !== headEvent) {
        await this.rewind(slot.eventId);
        return;
      }
      await this.switch(slot.branch);
      const last = eventsMem.at(-1)?.id;
      if (last && slot.eventId !== last) await this.rewind(slot.eventId);
    },
    async rewind(to) {
      if (!deps.policy().timeline.allowRewind) throw new AnimaeError("REWIND_DISABLED", "Rewind disabled by policy");
      if (!eventsMem.some((e) => e.id === to)) throw new AnimaeError("EVENT_NOT_FOUND", `Event ${to} not found in chain`);
      const parentName = branch;
      const parentEvents = [...eventsMem];
      const parentState = structuredClone(state);
      const headers = await loadAllBranchHeaders();
      const newName = nextBranchName(headers.map((h) => h.branch));
      await deps.storage.writeAtomic(
        eventsPath(newName),
        `${JSON.stringify({ kind: "branch.header", branch: newName, parent: parentName, forkAt: to })}\n`,
      );
      branch = newName;
      await persistHead();
      const truncated = parentEvents.filter((e) => parseEventSeq(e.id) <= parseEventSeq(to));
      state = await rebuildState(deps.authored(), deps.policy(), truncated);
      eventsMem = [...truncated];
      await appendInternal([{ kind: "branch.forked", parent: parentName, forkAt: to } as EventDraft]);
      const carry = await collectCarry(deps.storage, deps.policy(), deps.cel, parentName, to, parentEvents, parentState);
      for (const line of carry.artifactLines) {
        await artifacts.appendJsonl(line.path, line.obj);
      }
      await appendInternal(carry.drafts);
      await reloadEventsAndState();
      return { name: newName, parent: parentName, forkAt: to };
    },
    async branches() {
      const headers = await loadAllBranchHeaders();
      return headers.map((h) => ({ name: h.branch, parent: h.parent, forkAt: h.forkAt }));
    },
    async switch(b) {
      const name = typeof b === "string" ? b : b.name;
      if (!(await deps.storage.exists(eventsPath(name)))) throw new AnimaeError("BRANCH_NOT_FOUND", name);
      branch = name;
      await persistHead();
      await reloadEventsAndState();
    },
    async diff(a, b) {
      return diffBranches(deps, a, b);
    },
    async prune(b) {
      const name = typeof b === "string" ? b : b.name;
      if (name === branch) throw new AnimaeError("PRUNE_CURRENT", "Cannot prune current branch");
      const headers = await loadAllBranchHeaders();
      if (headers.some((h) => h.parent === name)) throw new AnimaeError("PRUNE_HAS_CHILDREN", "Branch has children");
      await deps.storage.remove(branchDir(name), { recursive: true });
    },
    async purge(scope) {
      await purgeEventsAndArtifacts(deps, { branch, chain, state, events: eventsMem, scope, append: (d) => appendInternal(d) });
      await reloadEventsAndState();
    },
    exportBranch(b, o) {
      const name = typeof b === "string" ? b : b.name;
      return exportBranchToFile(deps, name, o);
    },
    async importFile(file) {
      const ref = await importBranchFromFile(deps, file);
      for (const w of ref.warnings ?? []) {
        await appendInternal([{ kind: "config.warning", code: w.code, message: w.message, file: w.file } as EventDraft]);
      }
      await this.switch(ref.name);
      return ref;
    },
    async readRange(b, r) {
      const name = typeof b === "string" ? b : b.name;
      const brChain = await rebuildChainFromHeaders(name);
      const evs = await mergeChainEvents(brChain, async (bn) => (await readEventsFile(deps.storage, bn)).events);
      let out = evs;
      if (r?.from) out = out.filter((e) => parseEventSeq(e.id) >= parseEventSeq(r.from!));
      if (r?.to) out = out.filter((e) => parseEventSeq(e.id) <= parseEventSeq(r.to!));
      return out;
    },
    async maybeSnapshot(reason) {
      if (!shouldSnapshot(state, reason)) return;
      const lastId = eventsMem.at(-1)?.id;
      if (!lastId) return;
      await writeSnapshot(deps.storage, branch, lastId, state);
    },
  };
}
