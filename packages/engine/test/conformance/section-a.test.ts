import { test, expect } from "bun:test";
import { createRng } from "../../src/timeline/rng.ts";
import { reduce } from "../../src/timeline/reducer.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { rebuildState } from "../../src/timeline/snapshots.ts";
import { MemoryStorage } from "../../src/store/memory.ts";
import { createTimeline } from "../../src/timeline/timeline-store.ts";
import { createRuleEngine } from "../../src/rules/rule-engine.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import { minimalAuthored, minimalPolicy, fakeCel } from "../timeline/fixture.ts";
import type { EngineEvent, EventDraft } from "../../src/types.ts";

const authored = minimalAuthored();
const policy = minimalPolicy({
  rules: {
    delta_table: { chat: { affinity: 3, mood: 1 } },
    marginal: { k: 0.15, halfLifeHours: 24 },
    turn_cap: {},
  },
});

function ev(kind: string, payload: Record<string, unknown>, id: string): EngineEvent {
  return {
    id,
    kind,
    t: { day: 1, minute: 480 },
    sid: "sess_fixed",
    source: "test",
    because: [],
    ...payload,
  } as EngineEvent;
}

function randomWorldVarSequence(rng: ReturnType<typeof createRng>, count: number): EngineEvent[] {
  const out: EngineEvent[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      ev(
        "world.var_set",
        { path: `k${i % 5}`, value: rng.int(0, 100) },
        `evt_${String(i + 1).padStart(4, "0")}`,
      ),
    );
  }
  return out;
}

test("I2: random world.var_set sequences — snapshot replay equals incremental reduce", async () => {
  const rng = createRng(42, "main", "property");
  for (let trial = 0; trial < 20; trial++) {
    const n = 3 + (rng.int(1, 12) % 10);
    const seq = randomWorldVarSequence(rng, n);
    const full = await rebuildState(authored, policy, seq);
    let inc = initialState(authored, policy);
    for (const e of seq) inc = reduce(inc, e, policy);
    expect(full).toEqual(inc);
  }
});

test("I2: mixed reducer-audit-style sequence replay equality", async () => {
  const seq: EngineEvent[] = [
    ev("scene.started", { sceneId: "scn_0001", location: "tavern", participants: ["player", "npc1"], fields: [] }, "evt_0001"),
    ev("turn.started", { turn: "turn_0001" }, "evt_0002"),
    ev("world.var_set", { path: "a", value: 1 }, "evt_0003"),
    ev("track.delta", { owner: "npc1", target: "player", track: "affinity", delta: 2, before: 55, after: 57 }, "evt_0004"),
    ev("turn.ended", { turn: "turn_0001" }, "evt_0005"),
    ev("scene.ended", { sceneId: "scn_0001", turns: 1 }, "evt_0006"),
  ];
  const full = await rebuildState(authored, policy, seq);
  let inc = initialState(authored, policy);
  for (const e of seq) inc = reduce(inc, e, policy);
  expect(full).toEqual(inc);
});

test("I6: rule fn rng uses timeline seed and root branch", () => {
  const cel = createCelEngine();
  const rules = createRuleEngine(cel, () => ({ seed: 99, rootBranch: "main" }));
  rules.register("dice_probe", (ctx) => [{ kind: "world.var_set", path: "r", value: ctx.rng() }]);
  const a = rules.run("dice_probe", {
    stage: "tick",
    state: initialState(authored, policy),
    authored,
    policy,
    time: { day: 1, minute: 0 },
    vars: {},
    rngKey: "probe",
  });
  const b = rules.run("dice_probe", {
    stage: "tick",
    state: initialState(authored, policy),
    authored,
    policy,
    time: { day: 1, minute: 0 },
    vars: {},
    rngKey: "probe",
  });
  expect(a).toEqual(b);
  const c = createRuleEngine(cel, () => ({ seed: 100, rootBranch: "main" }));
  c.register("dice_probe", (ctx) => [{ kind: "world.var_set", path: "r", value: ctx.rng() }]);
  const d = c.run("dice_probe", {
    stage: "tick",
    state: initialState(authored, policy),
    authored,
    policy,
    time: { day: 1, minute: 0 },
    vars: {},
    rngKey: "probe",
  });
  expect(d).not.toEqual(a);
});

test("I6: append + reload preserves events.jsonl bytes", async () => {
  const storage = MemoryStorage();
  const tl = createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => minimalPolicy(),
    cel: fakeCel,
    seed: 7,
    sessionId: "sess_fixed",
    modelMode: "live",
  });
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "x", value: 1, source: "test" }], { source: "test", because: [] });
  await tl.append([{ kind: "world.var_set", path: "y", value: 2, source: "test" }], { source: "test", because: ["evt_0001"] });
  const raw1 = (await storage.readText("timelines/main/events.jsonl"))!;
  await tl.close();
  const tl2 = createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => minimalPolicy(),
    cel: fakeCel,
    seed: 7,
    sessionId: "sess_fixed",
    modelMode: "live",
  });
  await tl2.open();
  const raw2 = (await storage.readText("timelines/main/events.jsonl"))!;
  expect(raw2).toBe(raw1);
  expect(tl2.events().every((e) => typeof e.source === "string" && e.source.length > 0)).toBe(true);
  expect(tl2.events().every((e) => Array.isArray(e.because))).toBe(true);
});

test("export manifest includes engine, preset, branch, chain, hashes", async () => {
  const storage = MemoryStorage();
  const tl = createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => minimalPolicy(),
    cel: fakeCel,
    seed: 1,
    sessionId: "s",
    modelMode: "live",
    presetId: "@animae/preset-base",
  });
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "m", value: 1 }]);
  const path = await tl.exportBranch("main");
  const text = (await storage.readText(path))!;
  const manifest = JSON.parse(text.split("\n")[0]!) as Record<string, unknown>;
  expect(manifest.engine).toBe("1.0.0");
  expect(manifest.preset).toBe("@animae/preset-base");
  expect(manifest.branch).toBe("main");
  expect(Array.isArray(manifest.chain)).toBe(true);
  expect(typeof manifest.hashes).toBe("object");
});

test("import branch name is content-derived (not wall clock)", async () => {
  const storage = MemoryStorage();
  const tl = createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => minimalPolicy(),
    cel: fakeCel,
    seed: 1,
    sessionId: "s",
    modelMode: "live",
  });
  await tl.open();
  await tl.append([{ kind: "world.var_set", path: "z", value: 0 }]);
  const file = await tl.exportBranch("main");
  const tl2 = createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => minimalPolicy(),
    cel: fakeCel,
    seed: 1,
    sessionId: "s2",
    modelMode: "live",
  });
  await tl2.open();
  const ref = await tl2.importFile(file);
  expect(ref.name.startsWith("import_")).toBe(true);
  expect(ref.name).not.toMatch(/import_\d{13}/);
});

test("snapshot at scene end", async () => {
  const storage = MemoryStorage();
  const tl = createTimeline({
    storage,
    authored: () => minimalAuthored(),
    policy: () => minimalPolicy(),
    cel: fakeCel,
    seed: 1,
    sessionId: "s",
    modelMode: "live",
  });
  await tl.open();
  await tl.append([{ kind: "scene.ended", sceneId: "scn_1", turns: 0 } as EventDraft]);
  await tl.maybeSnapshot("scene_end");
  const files = await storage.listFiles("timelines/main/snapshots");
  expect(files.some((f) => f.endsWith(".json"))).toBe(true);
});

test("I8: storage acquireLock writes pid file", async () => {
  const storage = MemoryStorage();
  await storage.acquireLock();
  const lock = await storage.readText(".animae.lock");
  expect(lock).toBe(String(process.pid));
  await storage.releaseLock();
});
