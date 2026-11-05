import { expect, test } from "bun:test";
import { createFakeKernel } from "./fake-kernel.ts";
import { fidelityForEntity, catchUpEntity } from "../../src/world/offscreen.ts";
import { minimalCharacter } from "./fake-kernel.ts";

test("fidelityForEntity resolves per-entity policy overrides", () => {
  const { k } = createFakeKernel({
    policyLayer: {
      offscreen: {
        fidelity: { default: "rule", locations: { tavern: "narrate" }, characters: { npc: "none" } },
      },
    },
  });
  expect(fidelityForEntity(k, { kind: "location", id: "tavern" })).toBe("narrate");
  expect(fidelityForEntity(k, { kind: "character", id: "npc" })).toBe("none");
  expect(fidelityForEntity(k, { kind: "item", id: "x" })).toBe("rule");
});

test("catchUp full fidelity writes encounter artifacts and memory.written", async () => {
  const fk = createFakeKernel({
    policyLayer: { offscreen: { fidelity: { default: "full", locations: {}, characters: {} } } },
    schedule: [
      {
        id: "meet",
        location: "tavern",
        characters: ["npc"],
        at: { day: 1, minute: 500 },
      },
    ],
  });
  fk.reloadState({
    ...fk.state(),
    locations: { ...fk.state().locations, tavern: { ...fk.state().locations.tavern!, lastSimulated: { day: 1, minute: 480 } } },
    time: { day: 1, minute: 520 },
  });
  const evs = await fk.world.catchUp({ kind: "location", id: "tavern" });
  expect(evs.some((e) => e.kind === "offscreen.simulated" && (e as { fidelity?: string }).fidelity === "full")).toBe(true);
  expect(evs.some((e) => e.kind === "memory.written")).toBe(true);
  expect(fk.artifacts["artifacts/_offscreen/encounter_meet_npc.jsonl"]?.length).toBe(1);
});

test("catchUp narrate uses S2 stream text when tier allowed", async () => {
  const fk = createFakeKernel({
    policyLayer: { offscreen: { fidelity: { default: "narrate", locations: {}, characters: {} } } },
    s2Handler: () => ({ text: "Smoke curls under the beams." }),
  });
  fk.reloadState({
    ...fk.state(),
    locations: { ...fk.state().locations, tavern: { ...fk.state().locations.tavern!, lastSimulated: { day: 1, minute: 0 } } },
    time: { day: 1, minute: 40 },
  });
  await fk.world.catchUp({ kind: "location", id: "tavern" });
  const line = fk.artifacts["artifacts/_offscreen/tavern.jsonl"]?.[0] as { text?: string } | undefined;
  expect(line?.text).toContain("Smoke");
});

test("catchUp full schedule without at still simulates encounters", async () => {
  const fk = createFakeKernel({
    policyLayer: { offscreen: { fidelity: { default: "full", locations: {}, characters: {} } } },
    schedule: [{ id: "open", location: "tavern", characters: ["npc"] }],
  });
  fk.reloadState({
    ...fk.state(),
    locations: { ...fk.state().locations, tavern: { ...fk.state().locations.tavern!, lastSimulated: { day: 1, minute: 480 } } },
    time: { day: 1, minute: 490 },
  });
  const evs = await fk.world.catchUp({ kind: "location", id: "tavern" });
  expect(evs.some((e) => e.kind === "memory.written")).toBe(true);
});

test("catchUp narrate model failure warns and skips artifact", async () => {
  const fk = createFakeKernel({
    policyLayer: { offscreen: { fidelity: { default: "narrate", locations: {}, characters: {} } } },
    router: {
      allow: () => ({ ok: true, events: [], tier: "only" }),
    },
    s2Handler: () => {
      throw new Error("model down");
    },
  });
  const warns: string[] = [];
  fk.k.warn = (code) => {
    warns.push(code);
  };
  fk.reloadState({
    ...fk.state(),
    locations: { ...fk.state().locations, tavern: { ...fk.state().locations.tavern!, lastSimulated: { day: 1, minute: 0 } } },
    time: { day: 1, minute: 30 },
  });
  await fk.world.catchUp({ kind: "location", id: "tavern" });
  expect(warns).toContain("OFFSCREEN_NARRATE_FAILED");
  expect(fk.artifacts["artifacts/_offscreen/tavern.jsonl"]).toBeUndefined();
});

test("catchUpEntity returns empty when character has no lastSimulated", async () => {
  const fk = createFakeKernel({
    policyLayer: { offscreen: { fidelity: { default: "rule", locations: {}, characters: { npc: "rule" } } } },
  });
  const drafts = await catchUpEntity(fk.k, { kind: "character", id: "npc" });
  expect(drafts).toHaveLength(0);
});

test("catchUpEntity direct export matches world.catchUp for characters", async () => {
  const fk = createFakeKernel({
    policyLayer: { offscreen: { fidelity: { default: "rule", locations: {}, characters: { npc: "rule" } } } },
    characters: { npc: minimalCharacter("npc") },
  });
  fk.reloadState({
    ...fk.state(),
    characters: {
      npc: { ...fk.state().characters.npc!, lastSimulated: { day: 1, minute: 0 } },
    },
    time: { day: 1, minute: 10 },
  });
  const drafts = await catchUpEntity(fk.k, { kind: "character", id: "npc" });
  expect(drafts.some((d) => d.kind === "offscreen.simulated")).toBe(true);
});
