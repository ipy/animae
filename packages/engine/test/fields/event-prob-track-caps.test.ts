import { expect, test } from "bun:test";
import { mergeFieldEffects, clampEffects, mergeTrackCaps, clampTrackWithFieldCaps } from "../../src/fields/index.ts";
import { buildCelContext } from "../../src/rules/cel-context.ts";
import { adjudicate } from "../../src/rules/adjudicate.ts";
import { getPromptSection } from "../../src/prompts/index.ts";
import { minimalAuthored, minimalPolicy } from "../timeline/fixture.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import type { FieldDef } from "../../src/schema/authored.ts";
import { createRng } from "../../src/timeline/rng.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import { createRuleEngine } from "../../src/rules/rule-engine.ts";

function baseField(partial: Partial<FieldDef> & Pick<FieldDef, "id">): FieldDef {
  return {
    holder: { kind: "character", ref: "npc1" },
    source: "author",
    scope: {},
    level: "L0",
    effects: {},
    priority: 0,
    stacking: "add",
    ...partial,
  };
}

test("event_prob merges additively and caps magnitudes", () => {
  const fields: FieldDef[] = [
    baseField({ id: "a", level: "L0", priority: 2, effects: { event_prob: { flirt: 0.2 } } }),
    baseField({ id: "b", level: "L0", priority: 1, effects: { event_prob: { flirt: 0.15, gift: 0.1 } } }),
  ];
  const { k } = createFakeKernel();
  const merged = mergeFieldEffects(fields, k, {});
  const { effects } = clampEffects(merged, { event_prob: 0.3 }, false);
  expect(effects.event_prob?.flirt).toBeCloseTo(0.3);
  expect(effects.event_prob?.gift).toBeCloseTo(0.1);
});

test("CEL fields.event_prob exposes aggregated map", () => {
  const authored = minimalAuthored();
  const policy = minimalPolicy();
  const state = initialState(authored, policy);
  const ctx = buildCelContext(
    { state, authored, policy, catalog: { character: () => undefined, location: () => undefined, item: () => undefined } as never, fieldEffects: { event_prob: { care: 0.12 } } },
    { self: "npc1", other: "player" },
  );
  expect((ctx.fields as { event_prob: Record<string, number> }).event_prob).toEqual({ care: 0.12 });
});

test("track_caps intersect across fields (narrow-only)", () => {
  expect(mergeTrackCaps({ mood: { min: 10, max: 90 } }, { mood: { min: 20, max: 80 } })?.mood).toEqual({ min: 20, max: 80 });
  expect(clampTrackWithFieldCaps(95, "mood", 0, 100, { mood: { max: 70 } })).toBe(70);
  expect(clampTrackWithFieldCaps(5, "mood", 0, 100, { mood: { min: 15 } })).toBe(15);
});

test("adjudicate clamps track delta with track_caps", () => {
  const authored = minimalAuthored();
  const policy = minimalPolicy({
    events: { types: { chat: { positive: true }, care: { positive: true }, other: { positive: false } } },
    rules: {
      delta_table: { care: { affinity: 5, mood: 3 } },
      marginal: { k: 0.15, halfLifeHours: 24 },
      turn_cap: { affinity: 20 },
    },
  });
  const state = initialState(authored, policy);
  const rng = createRng(1, "main", "t");
  const cel = createCelEngine();
  const rules = createRuleEngine(cel);
  const catalog = {
    character: (id: string) => authored.characters[id],
    location: (id: string) => authored.locations[id],
    item: (id: string) => authored.items[id],
    characters: () => Object.values(authored.characters),
    locations: () => Object.values(authored.locations),
    template: (kind: "character" | "location" | "item", id: string) => authored.templates[kind][id],
    knowledge: () => authored.knowledge,
  };
  const deps = {
    state,
    authored,
    policy,
    cel,
    rules,
    catalog,
    celContext: buildCelContext({ state, authored, policy, catalog }, { self: "npc1", other: "player", actor: "player" }),
  };
  const { drafts } = adjudicate(deps, {
    appraisal: { type: "care", intensity: 1, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
    actor: "player",
    owner: "npc1",
    turnId: "turn_0001",
    sceneId: "scn_1",
    fieldEffects: { track_caps: { affinity: { max: 56 } } },
    rng,
  });
  const aff = drafts.find((d) => d.kind === "track.delta" && (d as { track?: string }).track === "affinity") as
    | { after?: number }
    | undefined;
  expect(aff?.after).toBe(56);
});

test("prompt sections for event_prob and topic_access exist (fieldEffectsText)", () => {
  expect(getPromptSection("en", "field_event_prob", { rows: "flirt:0.2" })).toContain("flirt:0.2");
  expect(getPromptSection("en", "field_topics_closed", { list: "politics" })).toContain("politics");
  expect(getPromptSection("en", "field_topics_open", { list: "weather" })).toContain("weather");
});
