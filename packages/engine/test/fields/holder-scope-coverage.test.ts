import { expect, test } from "bun:test";
import { holderInvolved } from "../../src/fields/holder.ts";
import { scopeMatches } from "../../src/fields/scope.ts";
import type { FieldDef } from "../../src/schema/authored.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import type { EngineState } from "../../src/state.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { minimalAuthored, minimalPolicy } from "../timeline/fixture.ts";

const base: FieldDef = {
  id: "f",
  holder: { kind: "character", ref: "npc1" },
  source: "author",
  scope: {},
  level: "L0",
  effects: {},
  priority: 0,
  stacking: "add",
};

test("holderInvolved covers character, location, item, and global holders", () => {
  const state = initialState(minimalAuthored(), minimalPolicy());
  if (state.characters.npc1) state.characters.player = { ...state.characters.npc1, id: "player", name: "Player" };
  state.items.key = { id: "key", name: "Key", holder: { kind: "character", ref: "player" }, vars: {} };
  state.playerLocation = "tavern";
  const scene = { id: "scn_1", location: "tavern", participants: ["player", "npc1"] as string[] };
  expect(holderInvolved({ ...base, holder: { kind: "character", ref: "npc1" } }, scene, state)).toBe(true);
  expect(holderInvolved({ ...base, holder: { kind: "character", ref: "missing" } }, scene, state)).toBe(false);
  expect(holderInvolved({ ...base, holder: { kind: "location", ref: "tavern" } }, scene, state)).toBe(true);
  expect(holderInvolved({ ...base, holder: { kind: "location", ref: "street" } }, undefined, state)).toBe(false);
  expect(holderInvolved({ ...base, holder: { kind: "item", ref: "key" } }, scene, state)).toBe(true);
  expect(holderInvolved({ ...base, holder: { kind: "item", ref: "key" } }, undefined, state)).toBe(true);
  expect(holderInvolved({ ...base, holder: { kind: "world" } }, undefined, state)).toBe(true);
  expect(holderInvolved({ ...base, holder: { kind: "time" } }, undefined, state)).toBe(true);
  expect(holderInvolved({ ...base, holder: { kind: "external" } }, undefined, state)).toBe(true);
});

test("scopeMatches respects scene, location, time window, turns, when, and characters", () => {
  const cel = createCelEngine();
  const state = initialState(minimalAuthored(), minimalPolicy());
  const now = { day: 1, minute: 500 };
  const ctx = {
    scene: { id: "scn_1", location: "tavern", participants: ["player", "npc1"], turn: 2 },
    owner: "npc1",
    target: "player",
    cel,
    celCtx: {},
    state,
    now,
  };
  expect(scopeMatches({ ...base, scope: { scene: "scn_1" } }, ctx)).toBe(true);
  expect(scopeMatches({ ...base, scope: { scene: "other" } }, ctx)).toBe(false);
  expect(scopeMatches({ ...base, scope: { location: "tavern" } }, ctx)).toBe(true);
  expect(scopeMatches({ ...base, scope: { characters: ["npc1"] } }, ctx)).toBe(true);
  expect(scopeMatches({ ...base, scope: { characters: ["npc2"] } }, ctx)).toBe(false);
  expect(
    scopeMatches(
      { ...base, scope: { time: { from: { day: 1, minute: 400 }, to: { day: 1, minute: 600 } } } },
      ctx,
    ),
  ).toBe(true);
  expect(scopeMatches({ ...base, scope: { turns: 5 }, holder: { kind: "world" } }, { ...ctx, turnsActive: 3 })).toBe(true);
  expect(scopeMatches({ ...base, scope: { turns: 2 }, holder: { kind: "world" } }, { ...ctx, turnsActive: 3 })).toBe(false);
  expect(scopeMatches({ ...base, scope: { when: "true" }, holder: { kind: "world" } }, ctx)).toBe(true);
  expect(scopeMatches({ ...base, scope: { when: "false" }, holder: { kind: "world" } }, ctx)).toBe(false);
});
