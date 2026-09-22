import { test, expect } from "bun:test";
import { MemoryStorage } from "../../src/store/memory.ts";
import { createTimeline } from "../../src/timeline/timeline-store.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { rebuildState } from "../../src/timeline/snapshots.ts";
import { createRng } from "../../src/timeline/rng.ts";
import { replayChunks, eventMatches } from "../../src/timeline/replay.ts";
import { readEventsFile } from "../../src/timeline/event-log.ts";
import { sha256Hex } from "../../src/store/util.ts";
import { AnimaeError } from "../../src/types.ts";
import { minimalAuthored, minimalPolicy, fakeCel } from "./fixture.ts";
import { SNAPSHOT_EVERY } from "../../src/timeline/snapshots.ts";

function makeTimeline(storage = MemoryStorage()) {
  const authored = minimalAuthored();
  const policy = minimalPolicy();
  return createTimeline({
    storage,
    authored: () => authored,
    policy: () => policy,
    cel: fakeCel,
    seed: 42,
    sessionId: "sess1",
    modelMode: "live",
  });
}

test("append persist reload equals full replay", async () => {
  const storage = MemoryStorage();
  const tl = makeTimeline(storage);
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "k", value: 1 }]);
  await tl.append([{ kind: "world.var_set", path: "k", value: 2 }]);
  const st1 = structuredClone(tl.state());
  await tl.close();
  const tl2 = makeTimeline(storage);
  await tl2.open();
  expect(tl2.state()).toEqual(st1);
  expect(tl2.events().length).toBe(2);
});

test("snapshot matches full replay", async () => {
  const storage = MemoryStorage();
  const tl = makeTimeline(storage);
  await tl.open();
  for (let i = 0; i < SNAPSHOT_EVERY; i++) {
    await tl.append([{ kind: "world.var_set", path: "n", value: i }]);
  }
  await tl.maybeSnapshot("count");
  const snapState = structuredClone(tl.state());
  const full = await rebuildState(minimalAuthored(), minimalPolicy(), [...tl.events()]);
  expect(full).toEqual(snapState);
});

test("crash truncation recovery on open", async () => {
  const storage = MemoryStorage();
  const tl = makeTimeline(storage);
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "a", value: 1 }]);
  const path = "timelines/main/events.jsonl";
  const raw = (await storage.readText(path)) ?? "";
  await storage.writeAtomic(path, `${raw}\n{"broken":\n`);
  await tl.close();
  const tl2 = makeTimeline(storage);
  await tl2.open();
  expect(tl2.events().length).toBe(1);
});

test("rewind creates branch with carry", async () => {
  const storage = MemoryStorage();
  const tl = createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => minimalPolicy({ timeline: { allowRewind: true, carry: [] } }),
    cel: fakeCel,
    seed: 42,
    sessionId: "sess1",
    modelMode: "live",
  });
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "carry_me", value: 9 }]);
  const e1 = tl.events().at(-1)!.id;
  await tl.append([{ kind: "world.var_set", path: "after", value: 1 }]);
  const ref = await tl.rewind(e1);
  expect(ref.parent).toBe("main");
  expect(tl.branch().name).not.toBe("main");
  expect(tl.state().vars.after).toBeUndefined();
  expect(tl.events().some((e) => e.kind === "branch.forked")).toBe(true);
});

test("rewind disabled throws", async () => {
  const storage = MemoryStorage();
  const tl = createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => minimalPolicy({ timeline: { allowRewind: false, carry: [] } }),
    cel: fakeCel,
    seed: 1,
    sessionId: "s",
    modelMode: "live",
  });
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "x", value: 1 }]);
  await expect(tl.rewind(tl.events()[0]!.id)).rejects.toMatchObject({ code: "REWIND_DISABLED" });
});

test("artifacts COW at fork", async () => {
  const storage = MemoryStorage();
  const tl = makeTimeline(storage);
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "marker", value: 0 }]);
  await tl.artifacts.appendJsonl("npc1/memory.jsonl", { id: "m1", text: "before" });
  const forkAt = tl.events().at(-1)!.id;
  await tl.append([{ kind: "world.var_set", path: "z", value: 0 }]);
  await tl.rewind(forkAt);
  await tl.artifacts.appendJsonl("npc1/memory.jsonl", { id: "m2", text: "after" });
  const mainTl = makeTimeline(storage);
  await mainTl.open();
  await mainTl.switch("main");
  const mainRows = await mainTl.artifacts.readJsonl("npc1/memory.jsonl");
  expect(mainRows.some((r) => (r as { id?: string }).id === "m2")).toBe(false);
  expect(tl.artifacts.readJsonl("npc1/memory.jsonl")).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "m2" })]));
});

test("save and load slot", async () => {
  const storage = MemoryStorage();
  const tl = createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => minimalPolicy({ timeline: { allowRewind: true, carry: [] } }),
    cel: fakeCel,
    seed: 42,
    sessionId: "sess1",
    modelMode: "live",
  });
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "s", value: 1 }]);
  const slot = await tl.save("slot1");
  await tl.append([{ kind: "world.var_set", path: "s", value: 99 }]);
  await tl.load(slot);
  expect(tl.state().vars.s).toBe(1);
});

test("rng deterministic", () => {
  const a = createRng(42, "main", "turn");
  const b = createRng(42, "main", "turn");
  expect(a.next()).toBe(b.next());
  expect(a.int(1, 6)).toBe(b.int(1, 6));
});

test("on() wildcard subscription", async () => {
  const tl = makeTimeline();
  await tl.open();
  const seen: string[] = [];
  const off = tl.on("track.*", (e) => seen.push(e.kind));
  await tl.append([{ kind: "track.delta", source: "t", owner: "a", target: "b", track: "mood", delta: 1, value: 1 }]);
  await tl.append([{ kind: "utterance", source: "t", speaker: "a", text: "hi", cues: [] }]);
  off();
  expect(seen).toEqual(["track.delta"]);
});

test("replayChunks and eventMatches", () => {
  expect(eventMatches("track.*", "track.delta")).toBe(true);
  expect(eventMatches("*", "utterance")).toBe(true);
  const chunks = replayChunks([
    { id: "evt_0001", kind: "turn.started", turn: "turn_0001", t: { day: 1, minute: 0 }, sid: "s", source: "e", because: [] },
    { id: "evt_0002", kind: "utterance", speaker: "a", text: "hello", cues: [{ type: "smile", args: {}, at: 0 }], t: { day: 1, minute: 0 }, sid: "s", source: "e", because: [] },
    { id: "evt_0003", kind: "turn.ended", turn: "turn_0001", t: { day: 1, minute: 0 }, sid: "s", source: "e", because: [] },
  ]);
  expect(chunks.some((c) => c.type === "text")).toBe(true);
  expect(chunks.some((c) => c.type === "done")).toBe(true);
});

test("export import round trip and tamper detection", async () => {
  const storage = MemoryStorage();
  const tl = makeTimeline(storage);
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "export", value: 1 }]);
  const file = await tl.exportBranch("main");
  const tampered = (await storage.readText(file))!.replace("export", "exportX");
  const badPath = "exports/tampered.asave.jsonl";
  await storage.writeAtomic(badPath, tampered);
  const tl2 = makeTimeline(storage);
  await tl2.open();
  await expect(tl2.importFile(badPath)).rejects.toMatchObject({ code: "IMPORT_HASH_MISMATCH" });
  await tl2.importFile(file);
  expect(tl2.state().vars.export).toBe(1);
});

test("recordings record and replay lookup", async () => {
  const storage = MemoryStorage();
  const tl = createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => minimalPolicy(),
    cel: fakeCel,
    seed: 1,
    sessionId: "s",
    modelMode: "record",
  });
  await tl.open();
  await tl.recordings.record("key1", { ok: true });
  expect(tl.recordings.lookup("key1")).toEqual({ ok: true });
});

test("prune rejects current and children", async () => {
  const storage = MemoryStorage();
  const tl = makeTimeline(storage);
  await tl.open();
  await expect(tl.prune("main")).rejects.toMatchObject({ code: "PRUNE_CURRENT" });
  await tl.append([{ kind: "world.var_set", path: "p", value: 1 }]);
  const fork = await tl.rewind(tl.events().at(-1)!.id);
  await expect(tl.prune("main")).rejects.toMatchObject({ code: "PRUNE_HAS_CHILDREN" });
  void fork;
});

test("initial open creates branch header", async () => {
  const storage = MemoryStorage();
  const tl = makeTimeline(storage);
  await tl.open();
  const { header } = await readEventsFile(storage, "main");
  expect(header.branch).toBe("main");
});

test.skip("benchmark: open stays fast on 10k-event log", async () => {
  const storage = MemoryStorage();
  const tl = makeTimeline(storage);
  await tl.open();
  for (let i = 0; i < 10_000; i++) {
    await tl.append([{ kind: "world.var_set", path: `bench.${i}`, value: i }]);
  }
  await tl.close();
  const t0 = performance.now();
  const tl2 = makeTimeline(storage);
  await tl2.open();
  const ms = performance.now() - t0;
  expect(tl2.events().length).toBeGreaterThanOrEqual(10_000);
  expect(ms).toBeLessThan(5000);
  await tl2.close();
});

test("events.jsonl tail repair after truncated append", async () => {
  const storage = MemoryStorage();
  const tl = makeTimeline(storage);
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "ok", value: 1 }]);
  const path = "timelines/main/events.jsonl";
  const raw = (await storage.readText(path)) ?? "";
  const broken = `${raw}{"kind":"world.var_set","path":"bad"`;
  await storage.writeAtomic(path, broken);
  await tl.close();
  const tl2 = makeTimeline(storage);
  await tl2.open();
  expect(tl2.events().some((e) => (e as { path?: string }).path === "ok")).toBe(true);
  expect(tl2.events().some((e) => (e as { path?: string }).path === "bad")).toBe(false);
  await tl2.close();
});
