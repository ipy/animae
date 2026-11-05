import { describe, expect, test } from "bun:test";
import { decayTicks } from "../../src/rules/decay.ts";
import type { RulesDeps } from "../../src/rules/deps.ts";
import type { CharacterState, EngineState } from "../../src/state.ts";
import type { ResolvedPolicy } from "../../src/schema/policy.ts";
import { minimalAuthored, fakeCel, minimalPolicy } from "../timeline/fixture.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { createRuleEngine } from "../../src/rules/rule-engine.ts";

function characterState(
  id: string,
  tracks: CharacterState["tracks"],
  tiers: CharacterState["tiers"],
): CharacterState {
  return {
    id,
    name: id,
    lod: "extra",
    origin: "authored",
    tracks,
    tiers,
    vars: {},
    tags: [],
    goals: [],
    claims: [],
    interactions: 0,
    unlockedSecrets: [],
    lastSimulated: { day: 1, minute: 0 },
  };
}

function decayTestState(characters: Record<string, Pick<CharacterState, "tracks" | "tiers">>): EngineState {
  const authored = minimalAuthored();
  const policy = minimalPolicy();
  const state = initialState(authored, policy);
  for (const [id, partial] of Object.entries(characters)) {
    state.characters[id] = characterState(id, partial.tracks, partial.tiers);
  }
  return state;
}

function deps(state: EngineState, policy: ResolvedPolicy): RulesDeps {
  const authored = minimalAuthored();
  const rules = createRuleEngine(fakeCel);
  return {
    state,
    policy,
    authored,
    cel: fakeCel,
    rules,
    catalog: {
      character: (id: string) => authored.characters[id],
      location: (id: string) => authored.locations[id],
      item: (id: string) => authored.items[id],
      characters: () => Object.values(authored.characters),
      locations: () => Object.values(authored.locations),
      template: (kind, id) => authored.templates[kind][id],
      knowledge: () => authored.knowledge,
    },
    celContext: {},
  };
}

describe("decayTicks", () => {
  test("returns empty when hours non-positive", () => {
    const policy = minimalPolicy({
      tracks: {
        mood: {
          scope: "self",
          initial: 50,
          min: 0,
          max: 100,
          tiers: [{ name: "low", from: 0 }],
          hysteresis: 0,
          decay: { toward: 0, ratePerHour: 0.1 },
        },
      },
    });
    const state = decayTestState({
      a: {
        tracks: { self: { mood: 50 }, toward: { b: { affinity: 50 } } },
        tiers: { self: {}, toward: { b: {} } },
      },
    });
    expect(decayTicks(deps(state, policy), { day: 1, minute: 0 }, { day: 1, minute: 0 })).toEqual([]);
  });

  test("self-scope decay emits track.delta and tier.changed when crossing tier", () => {
    const policy = minimalPolicy({
      tracks: {
        mood: {
          scope: "self",
          initial: 50,
          min: 0,
          max: 100,
          tiers: [
            { name: "low", from: 0 },
            { name: "high", from: 70 },
          ],
          hysteresis: 0,
          decay: { toward: 0, ratePerHour: 1 },
        },
      },
    });
    const state = decayTestState({
      a: {
        tracks: { self: { mood: 80 }, toward: {} },
        tiers: { self: { mood: "high" }, toward: {} },
      },
    });
    const drafts = decayTicks(deps(state, policy), { day: 1, minute: 0 }, { day: 1, minute: 120 });
    expect(drafts.some((d) => d.kind === "track.delta" && d.reason === "decay")).toBe(true);
    expect(drafts.some((d) => d.kind === "tier.changed")).toBe(true);
  });

  test("relation-scope decay targets each toward entry", () => {
    const policy = minimalPolicy({
      tracks: {
        trust: {
          scope: "relation",
          initial: 50,
          min: 0,
          max: 100,
          tiers: [],
          hysteresis: 0,
          decay: { toward: 50, ratePerHour: 0.5 },
        },
      },
    });
    const state = decayTestState({
      a: {
        tracks: { self: {}, toward: { b: { trust: 40 }, c: { trust: 40 } } },
        tiers: { self: {}, toward: { b: {}, c: {} } },
      },
    });
    const drafts = decayTicks(deps(state, policy), { day: 1, minute: 0 }, { day: 1, minute: 60 });
    const deltas = drafts.filter((d) => d.kind === "track.delta");
    expect(deltas.length).toBe(2);
    expect(deltas.every((d) => (d as { target?: string }).target && (d as { owner?: string }).owner === "a")).toBe(true);
  });
});
