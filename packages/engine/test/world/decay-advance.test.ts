import { expect, test } from "bun:test";
import { decayStep } from "../../src/rules/primitives.ts";
import { createFakeKernel, minimalAuthored, minimalCharacter } from "./fake-kernel.ts";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";
import type { Policy } from "../../src/schema/policy.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { reduce } from "../../src/timeline/reducer.ts";

function policyWithDecay(extra?: Partial<Policy>) {
  return applyPolicyDefaults({
    tracks: {
      mood: {
        scope: "self",
        min: -100,
        max: 100,
        initial: 50,
        tiers: [],
        hysteresis: 0,
        decay: { toward: 0, ratePerHour: 0.1 },
      },
      stability: {
        scope: "self",
        min: 0,
        max: 100,
        initial: 80,
        tiers: [],
        hysteresis: 0,
        decay: { toward: 50, ratePerHour: 0.02 },
      },
    },
    ...extra,
  });
}

function kernelWithTracks() {
  const { authored, policy } = minimalAuthored({
    policyLayer: policyWithDecay() as Policy,
    characters: { npc: minimalCharacter("npc") },
  });
  const fk = createFakeKernel({ policyLayer: policyWithDecay() as Policy });
  let state = initialState(authored, policy);
  state = {
    ...state,
    characters: {
      npc: {
        ...state.characters.npc!,
        tracks: { self: { mood: 50, stability: 80 }, toward: {} },
      },
    },
  };
  fk.reloadState(state);
  return fk;
}

test("decay runs on advance without WORLD_DECAY_UNAVAILABLE", async () => {
  const fk = kernelWithTracks();
  await fk.world.advance("3h");
  const warnings = fk.events().filter((e) => e.kind === "config.warning");
  expect(warnings.some((e) => (e as { code?: string }).code === "WORLD_DECAY_UNAVAILABLE")).toBe(false);
  const moodDelta = fk.events().find((e) => e.kind === "track.delta" && (e as { track?: string }).track === "mood");
  expect(moodDelta).toBeTruthy();
  const after = (moodDelta as unknown as { after: number }).after;
  const distance = 50 - 0;
  const expected = Math.round((50 - distance * (1 - 0.9 ** 3)) * 100) / 100;
  expect(after).toBeCloseTo(expected, 2);
  expect(after).toBeCloseTo(decayStep(50, { toward: 0, ratePerHour: 0.1 }, 3), 2);
});

test("24×1h vs 1×24h mood decay equivalence", async () => {
  const mk = () => {
    const fk = kernelWithTracks();
    fk.reloadState({
      ...fk.state(),
      characters: {
        npc: {
          ...fk.state().characters.npc!,
          tracks: { self: { mood: 40, stability: 80 }, toward: {} },
        },
      },
    });
    return fk;
  };
  const a = mk();
  for (let i = 0; i < 24; i++) await a.world.advance("1h");
  const b = mk();
  await b.world.advance("24h");
  const moodA = a.state().characters.npc?.tracks.self.mood ?? 0;
  const moodB = b.state().characters.npc?.tracks.self.mood ?? 0;
  expect(moodA).toBeCloseTo(moodB, 1);
});

test("30-day stability decay closed-form", async () => {
  const fk = kernelWithTracks();
  await fk.world.advance("30d");
  const stab = fk.state().characters.npc?.tracks.self.stability ?? 0;
  const hours = 30 * 24;
  const expected = Math.round(decayStep(80, { toward: 50, ratePerHour: 0.02 }, hours) * 100) / 100;
  expect(stab).toBeCloseTo(expected, 1);
});

test("schedule and daily interleave with decay segments", async () => {
  const fk = createFakeKernel({
    world: { start: { day: 1, minute: 0 } },
    policyLayer: {
      ...policyWithDecay(),
      rules: {
        custom: [{ id: "d", stage: "daily", fn: "daily_marker", when: "true" }],
      },
    } as Policy,
    schedule: [{ id: "hourly", every: "hour", emit: { kind: "tick.hour" } }],
  });
  fk.k.rules.register("daily_marker", () => [{ kind: "test.daily" as const }]);
  await fk.world.advance({ to: { day: 2, minute: 1 } });
  const kinds = fk.events().map((e) => e.kind);
  const decayIdx = kinds.indexOf("track.delta");
  const schedIdx = kinds.findIndex((k) => k === "tick.hour");
  const dailyIdx = kinds.indexOf("test.daily");
  expect(decayIdx).toBeGreaterThanOrEqual(0);
  expect(schedIdx).toBeGreaterThan(decayIdx);
  expect(dailyIdx).toBeGreaterThan(0);
});

test("mood 50 after 3h advance is ~36.45", async () => {
  const fk = kernelWithTracks();
  await fk.world.advance("3h");
  const mood = fk.state().characters.npc?.tracks.self.mood ?? 0;
  expect(mood).toBeCloseTo(36.45, 2);
  const decayEvents = fk.events().filter(
    (e) => e.kind === "track.delta" && (e as { reason?: string }).reason === "decay",
  );
  expect(decayEvents.length).toBe(2);
});

test("catchUp for multiple entities does not re-apply decay", async () => {
  const policy = policyWithDecay() as Policy;
  const fk = createFakeKernel({
    policyLayer: policy,
    characters: {
      a: minimalCharacter("a"),
      b: minimalCharacter("b"),
    },
  });
  let state = fk.state();
  state = {
    ...state,
    characters: {
      a: { ...state.characters.a!, tracks: { self: { mood: 50, stability: 80 }, toward: {} } },
      b: { ...state.characters.b!, tracks: { self: { mood: 50, stability: 80 }, toward: {} } },
    },
  };
  fk.reloadState(state);
  await fk.world.advance("1h");
  await fk.world.catchUp({ kind: "character", id: "a" });
  await fk.world.catchUp({ kind: "character", id: "b" });
  expect(fk.state().characters.a?.tracks.self.mood).toBeCloseTo(45, 2);
  expect(fk.state().characters.b?.tracks.self.mood).toBeCloseTo(45, 2);
  const decay = fk.events().filter((e) => e.kind === "track.delta" && (e as { reason?: string }).reason === "decay");
  expect(decay.length).toBe(4);
});

test("decay not duplicated after rebuild from event log", async () => {
  const fk = kernelWithTracks();
  await fk.world.advance("3h");
  const events = fk.events();
  const { policy } = minimalAuthored({ policyLayer: policyWithDecay() as Policy });
  let state = initialState(minimalAuthored({ policyLayer: policyWithDecay() as Policy }).authored, policy);
  state = {
    ...state,
    characters: {
      npc: {
        ...state.characters.npc!,
        tracks: { self: { mood: 50, stability: 80 }, toward: {} },
      },
    },
  };
  for (const e of events) {
    state = reduce(state, e, policy);
  }
  const mood = state.characters.npc?.tracks.self.mood ?? 0;
  expect(mood).toBeCloseTo(decayStep(50, { toward: 0, ratePerHour: 0.1 }, 3), 2);
  expect(events.filter((e) => e.kind === "track.delta" && (e as { reason?: string }).reason === "decay").length).toBe(2);
});
