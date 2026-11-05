import { expect, test } from "bun:test";
import { reduce } from "../../src/timeline/reducer.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { minimalAuthored, minimalPolicy } from "./fixture.ts";
import type { EngineEvent } from "../../src/types.ts";

const authored = minimalAuthored();
const policy = minimalPolicy();

function ev(kind: string, payload: Record<string, unknown>, eventId: string): EngineEvent {
  return { id: eventId, kind, t: { day: 1, minute: 480 }, sid: "s", source: "t", because: [], ...payload } as EngineEvent;
}

function reflect(goal_changes: unknown[], new_claims: unknown[] = [], id = "evt_9000"): EngineEvent {
  return ev("reflection.accepted", { owner: "npc1", summaries: ["s"], goal_changes, new_claims }, id);
}

test("reflection goal changes add, update and remove goals by id", () => {
  let s = initialState(authored, policy);
  const base = s.characters.npc1!.goals.length;

  s = reduce(s, reflect([{ action: "add", id: "g_a", text: "Find the key", tags: ["quest"], priority: 2 }]), policy);
  s = reduce(s, reflect([{ action: "add", text: "Unnamed goal" }], [], "evt_9001"), policy);
  const goals = s.characters.npc1!.goals;
  expect(goals).toHaveLength(base + 2);
  expect(goals.find((g) => g.id === "g_a")).toEqual({ id: "g_a", text: "Find the key", tags: ["quest"], priority: 2 });
  // A goal without an id gets one from its position; text, tags and priority default.
  expect(goals.at(-1)).toEqual({ id: `goal_${base + 2}`, text: "Unnamed goal", tags: [], priority: 0 });

  // Update changes only the fields that are present.
  s = reduce(s, reflect([{ action: "update", id: "g_a", priority: 5 }], [], "evt_9002"), policy);
  expect(s.characters.npc1!.goals.find((g) => g.id === "g_a")).toEqual({
    id: "g_a",
    text: "Find the key",
    tags: ["quest"],
    priority: 5,
  });
  s = reduce(s, reflect([{ action: "update", id: "g_a", text: "Find the vault key", tags: [] }], [], "evt_9003"), policy);
  expect(s.characters.npc1!.goals.find((g) => g.id === "g_a")).toEqual({
    id: "g_a",
    text: "Find the vault key",
    tags: [],
    priority: 5,
  });

  s = reduce(s, reflect([{ action: "remove", id: "g_a" }], [], "evt_9004"), policy);
  expect(s.characters.npc1!.goals.some((g) => g.id === "g_a")).toBe(false);
  expect(s.characters.npc1!.goals).toHaveLength(base + 1);
});

test("goal changes that name no goal, no id or no known action change nothing", () => {
  let s = initialState(authored, policy);
  const before = structuredClone(s.characters.npc1!.goals);
  s = reduce(
    s,
    reflect([
      { action: "update", id: "no_such_goal", text: "x" },
      { action: "remove", id: "no_such_goal" },
      { action: "update", text: "no id" },
      { action: "remove" },
      { action: "explode", id: "g" },
      null,
      "not an object",
    ]),
    policy,
  );
  expect(s.characters.npc1!.goals).toEqual(before);
});

test("reflection claims are stored with the event that accepted them", () => {
  let s = initialState(authored, policy);
  s = reduce(s, reflect([], [{ s: "npc1", p: "trusts", o: "player" }], "evt_9100"), policy);
  const claim = s.characters.npc1!.claims.at(-1) as { s: string; p: string; o: string; src: string };
  expect(claim).toMatchObject({ s: "npc1", p: "trusts", o: "player", src: "evt_9100" });
});

test("a reflection for an unknown owner is ignored", () => {
  let s = initialState(authored, policy);
  const before = structuredClone(s.characters);
  s = reduce(
    s,
    ev("reflection.accepted", { owner: "nobody", summaries: [], goal_changes: [{ action: "add", text: "x" }], new_claims: [] }, "evt_9200"),
    policy,
  );
  expect(s.characters).toEqual(before);
});

test("spawning a location records its definition and a world location at the current time", () => {
  let s = initialState(authored, policy);
  const data = { id: "cellar", name: "Wine cellar", summary: "Cold.", tags: [], connects: [], vars: { damp: true } };
  s = reduce(s, ev("entity.spawned", { entity: { kind: "location", id: "cellar" }, data, entitySeq: 3 }, "evt_9300"), policy);
  expect(s.generated.locations.cellar).toEqual(data);
  expect(s.locations.cellar).toEqual({ id: "cellar", name: "Wine cellar", vars: { damp: true }, lastSimulated: s.time });
  expect(s.entitySeq).toBe(3);

  // Spawning the same id again keeps the world location (and its simulated state) as it is.
  s.locations.cellar!.vars.damp = false;
  s = reduce(
    s,
    ev("entity.spawned", { entity: { kind: "location", id: "cellar" }, data: { ...data, name: "Renamed" }, entitySeq: 2 }, "evt_9301"),
    policy,
  );
  expect(s.locations.cellar!.name).toBe("Wine cellar");
  expect(s.locations.cellar!.vars.damp).toBe(false);
  expect(s.entitySeq).toBe(3);
});

test("spawning an item records its holder, or none", () => {
  let s = initialState(authored, policy);
  s = reduce(
    s,
    ev(
      "entity.spawned",
      { entity: { kind: "item", id: "lamp" }, data: { id: "lamp", name: "Brass lamp", holder: { kind: "character", ref: "npc1" }, vars: { lit: false } } },
      "evt_9400",
    ),
    policy,
  );
  expect(s.generated.items.lamp).toBeDefined();
  expect(s.items.lamp).toEqual({ id: "lamp", name: "Brass lamp", holder: { kind: "character", ref: "npc1" }, vars: { lit: false } });

  s = reduce(s, ev("entity.spawned", { entity: { kind: "item", id: "coin" }, data: { id: "coin", name: "Coin" } }, "evt_9401"), policy);
  expect(s.items.coin).toEqual({ id: "coin", name: "Coin", holder: null, vars: {} });
});
