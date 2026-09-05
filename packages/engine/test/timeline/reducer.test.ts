import { test, expect } from "bun:test";
import { createReducer, reduce } from "../../src/timeline/reducer.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { minimalAuthored, minimalPolicy } from "./fixture.ts";
import type { EngineEvent } from "../../src/types.ts";

const authored = minimalAuthored();
const policy = minimalPolicy();

test("initialState sets tracks from policy and relations", () => {
  const s = initialState(authored, policy);
  expect(s.characters.npc1!.tracks.toward.player!.affinity).toBe(55);
  expect(s.vars.gold).toBe(10);
  expect(s.time).toEqual({ day: 1, minute: 480 });
});

test("world.var_set flat path", () => {
  let s = initialState(authored, policy);
  const e: EngineEvent = { id: "evt_0001", kind: "world.var_set", path: "base.food", value: 3, t: s.time, sid: "s", source: "test", because: [] };
  s = reduce(s, e, policy);
  expect(s.vars["base.food"]).toBe(3);
});

test("track.delta and turnAcc skip decay/carry", () => {
  let s = initialState(authored, policy);
  s = reduce(s, { id: "evt_0001", kind: "turn.started", turn: "turn_0001", t: s.time, sid: "s", source: "t", because: [] }, policy);
  s = reduce(
    s,
    {
      id: "evt_0002",
      kind: "track.delta",
      owner: "npc1",
      target: "player",
      track: "affinity",
      delta: 5,
      before: 55,
      after: 60,
      t: s.time,
      sid: "s",
      source: "t",
      because: [],
    },
    policy,
  );
  expect(s.characters.npc1!.tracks.toward.player!.affinity).toBe(60);
  expect(s.turnAcc.delta["npc1|player|affinity"]).toBe(5);
  s = reduce(
    s,
    {
      id: "evt_0003",
      kind: "track.delta",
      owner: "npc1",
      target: "player",
      track: "affinity",
      delta: 0,
      before: 60,
      after: 60,
      reason: "decay",
      t: s.time,
      sid: "s",
      source: "t",
      because: [],
    },
    policy,
  );
  expect(s.turnAcc.delta["npc1|player|affinity"]).toBe(5);
});

test("interactions on utterance to player", () => {
  let s = initialState(authored, policy);
  s = reduce(
    s,
    { id: "evt_0001", kind: "utterance", speaker: "npc1", addressee: "player", text: "hi", cues: [], t: s.time, sid: "s", source: "t", because: [] },
    policy,
  );
  expect(s.characters.npc1!.interactions).toBe(1);
});

test("appraisal increments marginal counter", () => {
  const r = createReducer(() => policy);
  let s = initialState(authored, policy);
  s = r(s, {
    id: "evt_0001",
    kind: "appraisal",
    actor: "player",
    addressee: "npc1",
    appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
    t: s.time,
    sid: "s",
    source: "t",
    because: [],
  });
  expect(s.counters["npc1|player|chat"]!.n).toBeCloseTo(1, 5);
});
