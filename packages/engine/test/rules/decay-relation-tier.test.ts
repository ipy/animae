import { describe, expect, test } from "bun:test";
import { decayTicks } from "../../src/rules/decay.ts";
import type { RulesDeps } from "../../src/rules/deps.ts";
import type { EngineState } from "../../src/state.ts";
import type { ResolvedPolicy } from "../../src/schema/policy.ts";

function deps(state: EngineState, policy: ResolvedPolicy): RulesDeps {
  return {
    state,
    policy,
    authored: {} as RulesDeps["authored"],
    cel: {} as RulesDeps["cel"],
    rules: {} as RulesDeps["rules"],
    catalog: {} as RulesDeps["catalog"],
    celContext: {} as RulesDeps["celContext"],
  };
}

describe("decayTicks relation tier.changed", () => {
  test("emits tier.changed toward a target when decay crosses boundary", () => {
    const state = {
      time: { day: 1, minute: 0 },
      characters: {
        a: {
          tracks: { self: {}, toward: { b: { warmth: 75 } } },
          tiers: { self: {}, toward: { b: { warmth: "high" } } },
        },
      },
    } as unknown as EngineState;
    const policy = {
      tracks: {
        warmth: {
          scope: "relation",
          initial: 50,
          min: 0,
          max: 100,
          tiers: [
            { name: "low", from: 0 },
            { name: "high", from: 70 },
          ],
          hysteresis: 0,
          decay: { toward: 0, ratePerHour: 2 },
        },
      },
    } as unknown as ResolvedPolicy;
    const drafts = decayTicks(deps(state, policy), { day: 1, minute: 0 }, { day: 1, minute: 180 });
    const tier = drafts.find((d) => d.kind === "tier.changed");
    expect(tier).toMatchObject({ owner: "a", target: "b", track: "warmth", from: "high", direction: "down" });
  });

  test("skips tracks without decay config", () => {
    const state = {
      time: { day: 1, minute: 0 },
      characters: { a: { tracks: { self: { mood: 50 }, toward: {} }, tiers: { self: {}, toward: {} } } },
    } as unknown as EngineState;
    const policy = {
      tracks: { mood: { scope: "self", initial: 50, min: 0, max: 100, tiers: [], hysteresis: 0 } },
    } as unknown as ResolvedPolicy;
    expect(decayTicks(deps(state, policy), { day: 1, minute: 0 }, { day: 2, minute: 0 })).toEqual([]);
  });
});
