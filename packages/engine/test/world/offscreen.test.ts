import { expect, test } from "bun:test";
import { createFakeKernel } from "./fake-kernel.ts";

test("catchUp none skips simulation", async () => {
  const fk = createFakeKernel({
    policyLayer: { offscreen: { fidelity: { default: "none", locations: {}, characters: {} } } },
  });
  const evs = await fk.world.catchUp({ kind: "location", id: "tavern" });
  expect(evs).toHaveLength(0);
});

test("catchUp rule emits offscreen.simulated", async () => {
  const fk = createFakeKernel();
  fk.reloadState({
    ...fk.state(),
    locations: { ...fk.state().locations, tavern: { ...fk.state().locations.tavern!, lastSimulated: { day: 1, minute: 0 } } },
    time: { day: 1, minute: 100 },
  });
  const evs = await fk.world.catchUp({ kind: "location", id: "tavern" });
  expect(evs.some((e) => e.kind === "offscreen.simulated")).toBe(true);
  expect(fk.state().locations.tavern?.lastSimulated).toEqual({ day: 1, minute: 100 });
});

test("catchUp narrate uses S1 and artifact when allowed", async () => {
  const fk = createFakeKernel({
    policyLayer: { offscreen: { fidelity: { default: "narrate", locations: {}, characters: {} } } },
    s1Handler: () => ({ text: "Ash marks the floor." }),
  });
  fk.reloadState({
    ...fk.state(),
    locations: { ...fk.state().locations, tavern: { ...fk.state().locations.tavern!, lastSimulated: { day: 1, minute: 0 } } },
    time: { day: 1, minute: 50 },
  });
  await fk.world.catchUp({ kind: "location", id: "tavern" });
  expect(fk.artifacts["artifacts/_offscreen/tavern.jsonl"]?.length).toBe(1);
});

test("skip_offscreen_narrate degrade skips narrate artifact", async () => {
  const fk = createFakeKernel({
    policyLayer: {
      offscreen: { fidelity: { default: "narrate", locations: {}, characters: {} } },
      router: { degrade: ["skip_offscreen_narrate"] },
    },
    router: {
      allow: (job) =>
        job === "offscreen_narrate"
          ? { ok: false, events: [{ kind: "budget.degraded", action: "skip_offscreen_narrate" }] }
          : { ok: true, events: [] },
    },
  });
  fk.reloadState({
    ...fk.state(),
    locations: { ...fk.state().locations, tavern: { ...fk.state().locations.tavern!, lastSimulated: { day: 1, minute: 0 } } },
    time: { day: 1, minute: 50 },
  });
  const evs = await fk.world.catchUp({ kind: "location", id: "tavern" });
  expect(evs.some((e) => e.kind === "budget.degraded")).toBe(true);
  expect(fk.artifacts["artifacts/_offscreen/tavern.jsonl"]).toBeUndefined();
});
