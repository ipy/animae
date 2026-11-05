import { describe, expect, test } from "bun:test";
import { createFakeKernel } from "./fake-kernel.ts";

describe("calendar helpers on the world service", () => {
  test("chapter names the chapter of a day, the current one by default, and none outside every chapter", () => {
    const { world } = createFakeKernel();
    expect(world.chapter()).toMatchObject({ id: "ch1" });
    expect(world.chapter({ day: 7, minute: 1439 })).toMatchObject({ id: "ch1" });
    expect(world.chapter({ day: 8, minute: 0 })).toMatchObject({ id: "ch2" });
    expect(world.chapter({ day: 99, minute: 0 })).toBeUndefined();
  });

  test("format splits a time into hour, minute, clock text and weekday", () => {
    const { world } = createFakeKernel();
    expect(world.format({ day: 1, minute: 480 })).toEqual({ day: 1, hour: 8, minute: 0, hhmm: "08:00", weekday: "Mon" });
    expect(world.format({ day: 9, minute: 61 })).toEqual({ day: 9, hour: 1, minute: 1, hhmm: "01:01", weekday: "Tue" });
  });

  test("toMinutes and fromMinutes are inverse", () => {
    const { world } = createFakeKernel();
    expect(world.toMinutes({ day: 2, minute: 61 })).toBe(1501);
    expect(world.fromMinutes(1501)).toEqual({ day: 2, minute: 61 });
    for (const t of [{ day: 1, minute: 0 }, { day: 5, minute: 1439 }, { day: 30, minute: 720 }]) {
      expect(world.fromMinutes(world.toMinutes(t))).toEqual(t);
    }
  });
});

describe("catchUp refuses what it cannot simulate", () => {
  test("an item is not an offscreen entity", async () => {
    const { world, events } = createFakeKernel();
    await expect(world.catchUp({ kind: "item", id: "key" } as never)).rejects.toMatchObject({ code: "OFFSCREEN_ENTITY" });
    expect(events()).toEqual([]);
  });

  test("an unknown location or character is named in the error", async () => {
    const { world } = createFakeKernel();
    await expect(world.catchUp({ kind: "location", id: "nowhere" })).rejects.toMatchObject({
      code: "LOCATION_UNKNOWN",
      message: 'unknown location "nowhere"',
    });
    await expect(world.catchUp({ kind: "character", id: "ghost" })).rejects.toMatchObject({
      code: "CHARACTER_UNKNOWN",
      message: 'unknown character "ghost"',
    });
  });
});
