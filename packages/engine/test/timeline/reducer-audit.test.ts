import { test, expect } from "bun:test";
import { reduce } from "../../src/timeline/reducer.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { parseEventSeq } from "../../src/timeline/ids.ts";
import { rebuildState } from "../../src/timeline/snapshots.ts";
import { minimalAuthored, minimalPolicy } from "./fixture.ts";
import type { EngineEvent } from "../../src/types.ts";

const authored = minimalAuthored();
const policy = minimalPolicy();

function ev(kind: string, payload: Record<string, unknown>, id: string): EngineEvent {
  return { id, kind, t: { day: 1, minute: 480 }, sid: "s", source: "t", because: [], ...payload } as EngineEvent;
}

const mixed: EngineEvent[] = [
  ev("scene.started", { sceneId: "scn_0001", location: "tavern", participants: ["player", "npc1"], fields: [] }, "evt_0001"),
  ev("turn.started", { turn: "turn_0001" }, "evt_0002"),
  ev("rule.window_opened", { id: "w1", owner: "npc1", target: "player", untilScene: 5, durationScenes: 2 }, "evt_0003"),
  ev("track.delta", { owner: "npc1", target: "player", track: "affinity", delta: 5, before: 55, after: 60 }, "evt_0004"),
  ev("rule.threshold_fired", { id: "th1", owner: "npc1", target: "player" }, "evt_0005"),
  ev("character.var_set", { id: "npc1", key: "flag", value: true }, "evt_0006"),
  ev("info_arrival", { tags: ["clue"] }, "evt_0006b"),
  ev(
    "field.granted",
    {
      field: {
        id: "f1",
        holder: { kind: "character", ref: "npc1" },
        source: "author",
        scope: {},
        level: "L0",
        effects: {},
        priority: 0,
        stacking: "add",
      },
    },
    "evt_0006c",
  ),
  ev("field.age", { field: "f1", scenes: 1 }, "evt_0006d"),
  ev("world.moved", { who: "npc1", from: "tavern", to: "street" }, "evt_0006e"),
  ev("budget.degraded", { degraded: ["s2_tier_down"], action: "s2_tier_down", from: "pro", to: "standard" }, "evt_0007"),
  ev(
    "route.decided",
    {
      appraise: { backend: "llm", slot: "s1", model: "m/s1" },
      render: { backend: "llm", slot: "s2", tier: "pro", model: "m/pro" },
      triggers: ["anchor_near"],
      escalated: true,
      budget: { s1Calls: 1, s2CallsByTier: { pro: 1 } },
    },
    "evt_0008",
  ),
  ev("reflection.accepted", {
    owner: "npc1",
    summaries: ["s"],
    goal_changes: [{ action: "add", text: "new goal", tags: [], id: "g_new" }],
    new_claims: [{ s: "a", p: "b", o: "c" }],
  }, "evt_0009"),
  ev("character.promoted", { id: "npc1", from: "supporting", to: "principal", data: { name: "Npc One+" } }, "evt_0010"),
  ev("turn.ended", { turn: "turn_0001" }, "evt_0012"),
  ev("scene.ended", { sceneId: "scn_0001", turns: 1 }, "evt_0013"),
];

test("mixed event sequence reducer effects", () => {
  let s = initialState(authored, policy);
  for (const e of mixed) s = reduce(s, e, policy);
  expect(s.windows.w1?.untilScene).toBe(5);
  expect(s.firedThresholds["th1|npc1|player"]).toBe(true);
  expect(s.characters.npc1!.vars.flag).toBe(true);
  expect(s.fields.f1?.scenesElapsed).toBe(1);
  expect(s.characters.npc1?.location).toBe("street");
  expect(s.budget.degraded).toContain("s2_tier_down");
  expect(s.budget.s2Turns).toBe(1);
  expect(s.budget.escalated).toBe(1);
  expect(s.budget.s2ByTier).toEqual({ pro: 1 });
  expect(s.characters.npc1!.goals.some((g) => g.id === "g_new")).toBe(true);
  expect(s.generated.characters.npc1).toBeDefined();
  expect(s.scene).toBeNull();
});

test("item.moved updates holder when item exists", () => {
  let s = initialState(authored, policy);
  s.items.item1 = { id: "item1", name: "Key", holder: null, vars: {} };
  s = reduce(s, ev("item.moved", { item: "item1", to: { kind: "character", ref: "npc1" } }, "evt_x"), policy);
  expect(s.items.item1?.holder).toEqual({ kind: "character", ref: "npc1" });
});

test("snapshot replay equals incremental reduce for mixed sequence", async () => {
  const full = await rebuildState(authored, policy, mixed);
  let inc = initialState(authored, policy);
  for (const e of mixed) inc = reduce(inc, e, policy);
  expect(full).toEqual(inc);
});

test("rebuildState from snapshot at log head does not re-reduce covered events", async () => {
  const seq: EngineEvent[] = [
    ev("scene.started", { sceneId: "scn_0001", location: "tavern", participants: ["player", "npc1"], fields: [] }, "evt_0001"),
    ev("turn.started", { turn: "turn_0001" }, "evt_0002"),
    ev("track.delta", { owner: "npc1", target: "player", track: "affinity", delta: 2, before: 55, after: 57 }, "evt_0003"),
    ev("turn.ended", { turn: "turn_0001" }, "evt_0004"),
    ev("scene.ended", { sceneId: "scn_0001", turns: 1 }, "evt_0005"),
  ];
  let inc = initialState(authored, policy);
  for (const e of seq) inc = reduce(inc, e, policy);
  const last = seq.at(-1)!;
  const snap = { eventId: last.id, seq: parseEventSeq(last.id), state: structuredClone(inc) };
  const fromSnap = await rebuildState(authored, policy, seq, snap);
  expect(fromSnap).toEqual(inc);
});
