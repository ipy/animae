import { describe, expect, test } from "bun:test";
import { createFakeKernel } from "./fake-kernel.ts";

describe("WorldService.runSchedule", () => {
  const schedule = [{ id: "bell", at: "day 1 09:00", emit: { kind: "test.bell" } }];

  test("fires the items that fall inside the range, in the order they are due, and logs each firing", async () => {
    const fk = createFakeKernel({
      schedule: [
        { id: "late", at: "day 1 10:00", emit: { kind: "test.late" } },
        { id: "early", at: "day 1 09:00", emit: { kind: "test.early" } },
        { id: "after", at: "day 1 12:00", emit: { kind: "test.after" } },
      ],
    });
    const out = await fk.world.runSchedule({ day: 1, minute: 480 }, { day: 1, minute: 660 });
    expect(out.map((e) => e.kind).filter((k) => k.startsWith("test."))).toEqual(["test.early", "test.late"]);
    const fired = out.filter((e) => e.kind === "schedule.fired").map((e) => (e as unknown as { id: string }).id);
    expect(fired).toEqual(["early", "late"]);
    expect(fk.events().some((e) => e.kind === "test.after")).toBe(false);
  });

  test("an empty or backwards range fires nothing", async () => {
    const fk = createFakeKernel({ schedule });
    expect(await fk.world.runSchedule({ day: 1, minute: 600 }, { day: 1, minute: 600 })).toEqual([]);
    expect(await fk.world.runSchedule({ day: 1, minute: 700 }, { day: 1, minute: 480 })).toEqual([]);
    expect(fk.events()).toEqual([]);
  });

  test("an item that has fired is not fired again when the range is run twice", async () => {
    const fk = createFakeKernel({ schedule });
    const range = [{ day: 1, minute: 480 }, { day: 1, minute: 600 }] as const;
    const first = await fk.world.runSchedule(range[0], range[1]);
    expect(first.some((e) => e.kind === "test.bell")).toBe(true);
    const second = await fk.world.runSchedule(range[0], range[1]);
    expect(second.some((e) => e.kind === "test.bell")).toBe(false);
    expect(fk.events().filter((e) => e.kind === "test.bell")).toHaveLength(1);
  });
});

describe("WorldService.catchUpAll", () => {
  const behind = (fk: ReturnType<typeof createFakeKernel>) =>
    fk.reloadState({
      ...fk.state(),
      time: { day: 1, minute: 600 },
      locations: { ...fk.state().locations, tavern: { ...fk.state().locations.tavern!, lastSimulated: { day: 1, minute: 480 } } },
      characters: { ...fk.state().characters, npc: { ...fk.state().characters.npc!, lastSimulated: { day: 1, minute: 480 } } },
    });

  test("brings every location and character up to the current time", async () => {
    const fk = createFakeKernel();
    behind(fk);
    const out = await fk.world.catchUpAll();
    const simulated = out.filter((e) => e.kind === "offscreen.simulated");
    expect(simulated.length).toBeGreaterThanOrEqual(2);
    expect(fk.state().locations.tavern?.lastSimulated).toEqual({ day: 1, minute: 600 });
    expect(fk.state().characters.npc?.lastSimulated).toEqual({ day: 1, minute: 600 });
  });

  test("an entity already up to date costs nothing, so a second pass is quiet", async () => {
    const fk = createFakeKernel();
    behind(fk);
    await fk.world.catchUpAll();
    const eventsAfterFirst = fk.events().length;
    const again = await fk.world.catchUpAll();
    expect(again.filter((e) => e.kind === "offscreen.simulated")).toEqual([]);
    expect(fk.events()).toHaveLength(eventsAfterFirst);
  });

  test("fidelity none leaves everything as it was", async () => {
    const fk = createFakeKernel({ policyLayer: { offscreen: { fidelity: { default: "none", locations: {}, characters: {} } } } });
    behind(fk);
    expect(await fk.world.catchUpAll()).toEqual([]);
    expect(fk.state().locations.tavern?.lastSimulated).toEqual({ day: 1, minute: 480 });
  });
});
