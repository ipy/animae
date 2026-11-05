import { expect, test } from "bun:test";
import type { FieldDef } from "../../src/schema/authored.ts";
import { buildTestKernel, minimalAuthored, openPolicy } from "../helpers/fake-kernel.ts";

const field = (over: Partial<FieldDef>): FieldDef => ({
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

async function setup(fields: Record<string, FieldDef>, caps: Record<string, number> = {}) {
  const k = buildTestKernel(
    minimalAuthored({ fields }),
    openPolicy({ fields: { grants: [{ holder: "true", source: "true", maxLevel: "L4" }], caps } }),
  );
  await k.timeline.append([
    { kind: "scene.started", sceneId: "scn_1", location: "cafe", participants: ["player", "npc"], fields: [] },
  ]);
  const query = (turn: number, owner?: string) => ({
    scene: { id: "scn_1", location: "cafe", participants: ["player", "npc"], turn },
    ctx: {},
    ...(owner ? { owner } : {}),
  });
  return { k, query };
}

test("each field in play yields one field.applied draft naming the field, level, holder and effects", async () => {
  const { k, query } = await setup({
    f1: field({ id: "f1" }),
    f2: field({ id: "f2", level: "L1", holder: { kind: "location", ref: "cafe" }, effects: { track_offset: { trust: 1 } } }),
  });
  const { events } = k.fields.resolve(query(0));
  expect(events).toHaveLength(2);
  expect(events.every((e) => e.kind === "field.applied")).toBe(true);
  const byField = Object.fromEntries(events.map((e) => [(e as unknown as { field: string }).field, e]));
  expect(byField.f1).toMatchObject({
    source: "field:f1",
    level: "L0",
    holder: "character:npc",
    effects: { event_prob: { flirt: 0.2 } },
  });
  expect(byField.f2).toMatchObject({
    source: "field:f2",
    level: "L1",
    holder: "location:cafe",
    effects: { track_offset: { trust: 1 } },
  });
  // Nothing was capped, and only a level-4 field belongs to one owner's self-view.
  expect((byField.f1 as { clamped?: string[] }).clamped).toBeUndefined();
  expect((byField.f1 as { owner?: string }).owner).toBeUndefined();
});

test("effects beyond a cap are clamped and the draft names the capped paths", async () => {
  const { k, query } = await setup(
    { f1: field({ id: "f1", effects: { event_prob: { flirt: 0.8 }, track_offset: { trust: 2 } } }) },
    { event_prob: 0.25 },
  );
  const { events, applied } = k.fields.resolve(query(0));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    kind: "field.applied",
    effects: { event_prob: { flirt: 0.25 }, track_offset: { trust: 2 } },
    clamped: ["event_prob"],
  });
  expect(applied).toEqual([{ id: "f1", level: "L0", clamped: ["event_prob"] }]);
});

test("a level-4 field is reported with the owner whose self-view it shapes", async () => {
  const { k, query } = await setup({
    mood: field({ id: "mood", level: "L4", effects: { intent_bias: { talk: 1 } } }),
  });
  const { events } = k.fields.resolve(query(0, "npc"));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: "field.applied", level: "L4", owner: "npc", effects: { intent_bias: { talk: 1 } } });
});

test("the same application is reported once per turn, and again on the next turn", async () => {
  const { k, query } = await setup({ f1: field({ id: "f1" }) });
  expect(k.fields.resolve(query(0)).events).toHaveLength(1);
  // The same field, owner and effects within the turn: still applied, but not logged twice.
  const again = k.fields.resolve(query(0));
  expect(again.events).toHaveLength(0);
  expect(again.applied.map((a) => a.id)).toEqual(["f1"]);
  expect(again.effects.L0.event_prob?.flirt).toBe(0.2);
  expect(k.fields.resolve(query(1)).events).toHaveLength(1);
});
