import { expect } from "bun:test";
import type { Engine } from "../../src/api.ts";
import { loadAuthored } from "../../src/authored/load.ts";
import { createPresetRegistry } from "../../src/policy/registry.ts";
import { loadPolicy } from "../../src/policy/load.ts";
import type { PresetBundle } from "../../src/preset.ts";
import type { StoragePort } from "../../src/ports.ts";
import { sha256Hex, stableStringify } from "../../src/store/util.ts";
import { parseEventSeq } from "../../src/timeline/ids.ts";
import { snapshotsDir } from "../../src/timeline/paths.ts";
import { loadLatestSnapshot, rebuildState, type SnapshotFile } from "../../src/timeline/snapshots.ts";
import type { EngineEvent, WorldTime } from "../../src/types.ts";

const SCENE_SCOPED_SKIP = new Set([
  "scene.started",
  "scene.ended",
  "config.reloaded",
  "runtime.mode_changed",
  "world.advanced",
  "world.moved",
  "world.var_set",
  "memory.propagated",
  "timeline.saved",
  "timeline.loaded",
  "timeline.rewound",
  "branch.created",
]);

function timeCmp(a: WorldTime, b: WorldTime): number {
  if (a.day !== b.day) return a.day - b.day;
  return a.minute - b.minute;
}

/** Log integrity checks shared by every session e2e (spec invariants I1–I5, snapshot I2). */
export function assertLogInvariants(events: EngineEvent[]): void {
  expect(events.length).toBeGreaterThan(0);

  const ids = new Set<string>();
  let prevSeq = 0;
  for (const e of events) {
    expect(e.id).toMatch(/^evt_\d+$/);
    const seq = parseEventSeq(e.id);
    expect(seq).toBe(prevSeq + 1);
    prevSeq = seq;
    expect(ids.has(e.id)).toBe(false);
    ids.add(e.id);
    expect(typeof e.source).toBe("string");
    expect(e.source.length).toBeGreaterThan(0);
    for (const ref of e.because ?? []) {
      if (ref.startsWith("evt_")) expect(ids.has(ref)).toBe(true);
    }
  }

  let prevT: WorldTime | undefined;
  for (const e of events) {
    if (prevT && timeCmp(e.t, prevT) < 0) {
      expect(timeCmp(e.t, prevT)).toBeGreaterThanOrEqual(0);
    }
    prevT = e.t;
  }

  const openTurns = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "turn.started") {
      const tid = (e as { turn?: string }).turn;
      expect(typeof tid).toBe("string");
      openTurns.set(tid!, (openTurns.get(tid!) ?? 0) + 1);
    }
    if (e.kind === "turn.ended") {
      const tid = (e as { turn?: string }).turn;
      expect(typeof tid).toBe("string");
      expect(openTurns.has(tid!)).toBe(true);
      openTurns.set(tid!, (openTurns.get(tid!) ?? 0) - 1);
    }
  }
  for (const [, count] of openTurns) expect(count).toBe(0);

  const turnEndIndex = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.kind === "turn.ended") turnEndIndex.set((e as { turn?: string }).turn!, i);
  }
  const afterTurnAllowed = new Set(["timeline.saved", "timeline.loaded", "timeline.rewound", "branch.created", "scene.ended"]);
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (!e.turn) continue;
    const endIdx = turnEndIndex.get(e.turn);
    if (endIdx !== undefined && i > endIdx && !afterTurnAllowed.has(e.kind)) {
      expect(afterTurnAllowed.has(e.kind)).toBe(true);
    }
  }

  const routesByTurn = new Map<string, EngineEvent[]>();
  for (const e of events) {
    if (e.kind !== "route.decided" || !e.turn) continue;
    const list = routesByTurn.get(e.turn) ?? [];
    list.push(e);
    routesByTurn.set(e.turn, list);
  }
  for (const [turn, routes] of routesByTurn) {
    expect(routes.length).toBeGreaterThanOrEqual(1);
    const routeIdx = events.findIndex((x) => x === routes[0]);
    const turnStart = events.findIndex((x) => x.kind === "turn.started" && (x as { turn?: string }).turn === turn);
    expect(turnStart).toBeGreaterThanOrEqual(0);
    expect(routeIdx).toBeGreaterThan(turnStart);
    const utterIdx = events.findIndex((x) => x.kind === "utterance" && x.turn === turn);
    if (utterIdx >= 0) expect(routeIdx).toBeLessThan(utterIdx);
  }

  let activeScene: string | undefined;
  for (const e of events) {
    if (e.kind === "scene.started") activeScene = (e as { sceneId?: string }).sceneId;
    if (e.kind === "scene.ended") {
      expect((e as { sceneId?: string }).sceneId).toBe(activeScene);
      activeScene = undefined;
    }
    if (activeScene && e.scene && !SCENE_SCOPED_SKIP.has(e.kind)) {
      expect(e.scene).toBe(activeScene);
    }
  }
}

export function stateFingerprint(state: unknown): string {
  return sha256Hex(stableStringify(state));
}

/** Every on-disk snapshot must match full replay from the same event chain (I2). */
export async function assertSnapshotsMatchReplay(opts: {
  storage: StoragePort;
  branch: string;
  presets: PresetBundle[];
  events: EngineEvent[];
}): Promise<void> {
  const registry = createPresetRegistry(opts.presets);
  const authored = await loadAuthored(opts.storage, { presets: registry, liftDisplayStrings: true });
  const { policy } = await loadPolicy(opts.storage, authored.config, registry);
  const full = await rebuildState(authored, policy, opts.events);
  const fullHash = stateFingerprint(full);

  const latest = await loadLatestSnapshot(opts.storage, opts.branch);
  if (latest) {
    const fromSnap = await rebuildState(authored, policy, opts.events, latest.snap);
    expect(stateFingerprint(fromSnap)).toBe(fullHash);
    expect(fromSnap.seq).toBe(full.seq);
  }

  const files = (await opts.storage.listFiles(snapshotsDir(opts.branch))).filter((f) => f.endsWith(".json"));
  for (const path of files) {
    const text = await opts.storage.readText(path);
    expect(text).toBeTruthy();
    const snap = JSON.parse(text!) as SnapshotFile;
    const rebuilt = await rebuildState(authored, policy, opts.events, snap);
    expect(stateFingerprint(rebuilt)).toBe(fullHash);
  }
}

/** Live engine state matches full replay and every on-disk snapshot at the same seq (I2). */
export async function assertSnapshotEqualsReplay(
  engine: Engine,
  ctx: { storage: StoragePort; presets: PresetBundle[]; branch?: string },
): Promise<void> {
  const branch = ctx.branch ?? engine.info().branch;
  const live = engine.query("debug", "state") as Awaited<ReturnType<typeof rebuildState>>;
  expect(live).toBeDefined();
  const registry = createPresetRegistry(ctx.presets);
  const authored = await loadAuthored(ctx.storage, { presets: registry, liftDisplayStrings: true });
  const { policy } = await loadPolicy(ctx.storage, authored.config, registry);
  const events = await engine.timeline.events();
  const full = await rebuildState(authored, policy, events);
  expect(full).toEqual(live);
  await assertSnapshotsMatchReplay({ storage: ctx.storage, branch, presets: ctx.presets, events });
}

/** Keys allowed to differ between two deterministic runs (spec event envelope: session id only). */
export const DETERMINISM_EXEMPT_EVENT_KEYS = ["sid"] as const;

export function eventsForDeterminismCompare(events: EngineEvent[]): unknown[] {
  return events.map((e) => {
    const copy = { ...e } as Record<string, unknown>;
    for (const k of DETERMINISM_EXEMPT_EVENT_KEYS) delete copy[k];
    return copy;
  });
}

export function stableEventLogForCompare(events: EngineEvent[]): string {
  return stableStringify(eventsForDeterminismCompare(events));
}
