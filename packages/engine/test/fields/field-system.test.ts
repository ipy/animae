import { test, expect } from "bun:test";
import { buildTestKernel, minimalAuthored, openPolicy } from "../helpers/fake-kernel.ts";
import type { FieldDef } from "../../src/schema/authored.ts";

const baseField = (over: Partial<FieldDef>): FieldDef => ({
  id: "f1",
  holder: { kind: "character", ref: "npc" },
  source: "author",
  scope: {},
  level: "L0",
  effects: { event_prob: { flirt: 0.2 } },
  priority: 0,
  stacking: "add",
  ...over,
});

test("scope: location and holder character participant", async () => {
  const authored = minimalAuthored({
    fields: {
      loc: baseField({ id: "loc", holder: { kind: "location", ref: "cafe" }, scope: { location: "cafe" } }),
      npc: baseField({ id: "npc", holder: { kind: "character", ref: "npc" } }),
    },
  });
  const k = buildTestKernel(authored);
  await k.timeline.append([
    {
      kind: "scene.started",
      sceneId: "scn_1",
      location: "cafe",
      participants: ["player", "npc"],
      fields: [],
    },
  ]);
  const r = k.fields.resolve({
    scene: { id: "scn_1", location: "cafe", participants: ["player", "npc"], turn: 0 },
    ctx: {},
  });
  expect(r.applied.map((a) => a.id).sort()).toEqual(["loc", "npc"]);
});

test("an authored field with a non-author source is a template: inert until granted", async () => {
  const authored = minimalAuthored({
    fields: {
      live: baseField({ id: "live" }),
      tpl: baseField({ id: "tpl", source: "runtime", effects: { event_prob: { flirt: 0.5 } } }),
      rule_tpl: baseField({ id: "rule_tpl", source: "rule" }),
      anchor_tpl: baseField({ id: "anchor_tpl", source: "anchor" }),
    },
  });
  const k = buildTestKernel(authored, openPolicy({ fields: { grants: [{ holder: "true", source: "true", maxLevel: "L4" }], caps: {} } }));
  await k.timeline.append([
    { kind: "scene.started", sceneId: "scn_1", location: "cafe", participants: ["player", "npc"], fields: [] },
  ]);
  const query = { scene: { id: "scn_1", location: "cafe", participants: ["player", "npc"], turn: 0 }, ctx: {} };
  // only the author-sourced field applies on its own
  expect(k.fields.resolve(query).applied.map((a) => a.id)).toEqual(["live"]);

  // granting the template (the way a director or a game rule does) brings it into play
  const entry = await k.fields.grant(authored.fields.tpl!, { source: "runtime" });
  expect(entry.kind).toBe("field.granted");
  expect(
    k.fields
      .resolve({ ...query, scene: { ...query.scene, turn: 1 } })
      .applied.map((a) => a.id)
      .sort(),
  ).toEqual(["live", "tpl"]);
});

test("stacking add max and resolver", async () => {
  const authored = minimalAuthored({
    fields: {
      a: baseField({ id: "a", priority: 1, effects: { event_prob: { x: 0.1 } }, stacking: "add" }),
      b: baseField({ id: "b", priority: 0, effects: { event_prob: { x: 0.2 } }, stacking: "add" }),
      c: baseField({ id: "c", priority: 2, effects: { event_prob: { y: 0.5 } }, stacking: "max" }),
      d: baseField({ id: "d", priority: 1, effects: { event_prob: { y: 0.2 } }, stacking: "max" }),
      e: baseField({ id: "e", priority: 1, effects: { event_prob: { z: 1 } }, stacking: "resolver:pick_max" }),
      f: baseField({ id: "f", priority: 0, effects: { event_prob: { z: 3 } }, stacking: "resolver:pick_max" }),
    },
  });
  const k = buildTestKernel(authored, openPolicy({ fields: { grants: [{ holder: "true", source: "true", maxLevel: "L4" }], caps: {} } }));
  await k.timeline.append([
    { kind: "scene.started", sceneId: "scn_1", location: "cafe", participants: ["npc"], fields: [] },
  ]);
  const r = k.fields.resolve({
    scene: { id: "scn_1", location: "cafe", participants: ["npc"], turn: 0 },
    ctx: {},
  });
  expect(r.effects.L0.event_prob?.x).toBeCloseTo(0.3);
  expect(r.effects.L0.event_prob?.y).toBeCloseTo(0.5);
  expect(r.effects.L0.event_prob?.z).toBe(3);
});

test("stacking resolver on numeric leaf", async () => {
  const authored = minimalAuthored({
    fields: {
      e: baseField({
        id: "e",
        level: "L1",
        priority: 1,
        effects: { track_offset: { trust: 1 } },
        stacking: "resolver:pick_max",
      }),
      f: baseField({
        id: "f",
        level: "L1",
        priority: 0,
        effects: { track_offset: { trust: 3 } },
        stacking: "resolver:pick_max",
      }),
    },
  });
  const k = buildTestKernel(authored);
  await k.timeline.append([
    { kind: "scene.started", sceneId: "scn_1", location: "cafe", participants: ["npc"], fields: [] },
  ]);
  const r = k.fields.resolve({
    scene: { id: "scn_1", location: "cafe", participants: ["npc"], turn: 0 },
    ctx: {},
  });
  expect(r.effects.L1.track_offset?.trust).toBe(3);
});

test("caps clamp and bypass", async () => {
  const authored = minimalAuthored({
    fields: { f: baseField({ effects: { salience: [{ tags: ["t"], boost: 1 }] } }) },
    exceptions: { ex1: { id: "ex1", charges: 1, period: "session", mayBypass: ["field_cap"] } },
  });
  const k = buildTestKernel(authored);
  await k.timeline.append([
    { kind: "scene.started", sceneId: "scn_1", location: "cafe", participants: ["npc"], fields: [] },
  ]);
  const r = k.fields.resolve({
    scene: { id: "scn_1", location: "cafe", participants: ["npc"], turn: 0 },
    ctx: {},
  });
  expect(r.effects.L0.salience?.[0]?.boost).toBe(0.4);

  await k.director.invokeException("ex1", "field_cap");
  const r2 = k.fields.resolve({
    scene: { id: "scn_1", location: "cafe", participants: ["npc"], turn: 0 },
    ctx: {},
  });
  expect(r2.effects.L0.salience?.[0]?.boost).toBe(1);
});

test("grants deny runtime", async () => {
  const authored = minimalAuthored();
  const policy = openPolicy({ fields: { grants: [{ holder: "true", source: "source == 'nope'", maxLevel: "L4" }], caps: {} } });
  const k = buildTestKernel(authored, policy);
  const def = baseField({ id: "rt", source: "runtime", level: "L2" });
  const entry = await k.fields.grant(def, { source: "runtime" });
  expect(entry.kind).toBe("field.rejected");
});

test("L4 isolated to owner", () => {
  const authored = minimalAuthored({
    fields: { hid: baseField({ id: "hid", level: "L4", effects: { hide_entities: ["x"] } }) },
  });
  const k = buildTestKernel(authored);
  const r = k.fields.resolve({ owner: "npc", ctx: {} });
  expect(r.effects.L4.hide_entities).toEqual(["x"]);
  expect(r.effects.L0).toEqual({});
});

test("cost lifecycle with fallback", async () => {
  const authored = minimalAuthored();
  const k = buildTestKernel(authored);
  const def = baseField({
    id: "paid",
    source: "runtime",
    cost: {
      payer: "npc",
      ttlScenes: 1,
      effects: { event_prob: { due: -1 } },
      fallback: { effects: { event_prob: { due: -9 } } },
    },
  });
  await k.fields.grant(def, { source: "runtime" });
  await k.timeline.append([
    { kind: "scene.started", sceneId: "scn_1", location: "cafe", participants: ["npc"], fields: [] },
  ]);
  await k.fields.onSceneEnd();
  await k.fields.onSceneEnd();
  const ledger = k.fields.ledger();
  expect(ledger.some((e) => e.kind === "field.cost_due")).toBe(true);
  expect(ledger.some((e) => e.kind === "field.cost_settled")).toBe(true);
});
