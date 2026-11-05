import { describe, expect, test } from "bun:test";
import {
  fireTimesInRange,
  parseAtTime,
  parseEveryIntervalMinutes,
  parseScheduleDuration,
  phaseBoundaries,
  currentPhaseIndex,
} from "../../src/world/schedule-parse.ts";
import { AnimaeError } from "../../src/types.ts";
import type { Calendar } from "../../src/schema/authored.ts";
import { testScheduleItem } from "../helpers/schedule-item.ts";

const calendar: Calendar = { units: { minute: 1, hour: 60, day: 1440 }, sceneMinutes: 30, turnMinutes: 1, chapters: [] };
const sched = testScheduleItem;

describe("parseAtTime", () => {
  test("parses day-only and day with clock", () => {
    expect(parseAtTime("day 2", calendar)).toEqual({ day: 2, minute: 0 });
    expect(parseAtTime("day 3 14:30", calendar)).toEqual({ day: 3, minute: 14 * 60 + 30 });
  });

  test("rejects missing or malformed at", () => {
    expect(() => parseAtTime(undefined, calendar)).toThrow(AnimaeError);
    expect(() => parseAtTime("noon tomorrow", calendar)).toThrow(AnimaeError);
  });
});

describe("fireTimesInRange", () => {
  const from = { day: 1, minute: 0 };
  const to = { day: 2, minute: 0 };

  test("one-shot at fires once inside range respecting lastFired", () => {
    const times = fireTimesInRange(sched({ at: "day 1 12:00", every: undefined }), from, to, calendar, 0, undefined, false);
    expect(times).toEqual([12 * 60]);
    expect(fireTimesInRange(sched({ at: "day 1 12:00", every: undefined }), from, to, calendar, 0, { day: 1, minute: 12 * 60 }, false)).toEqual([]);
    expect(fireTimesInRange(sched({ at: "day 1 12:00", every: undefined }), from, to, calendar, 0, undefined, true)).toEqual([]);
  });

  test("hourly every fires on hour boundaries", () => {
    const times = fireTimesInRange(sched({ every: "hour" }), { day: 1, minute: 30 }, { day: 1, minute: 3 * 60 + 30 }, calendar, 0, undefined, false);
    expect(times).toEqual([60, 2 * 60, 3 * 60]);
  });

  test("every Nm steps align from range start", () => {
    const times = fireTimesInRange(sched({ every: "every 15m" }), { day: 1, minute: 10 }, { day: 1, minute: 50 }, calendar, 0, undefined, false);
    expect(times).toEqual([15, 30, 45]);
  });

  test("invalid every interval throws", () => {
    expect(() =>
      fireTimesInRange(sched({ every: "every 0m" }), from, to, calendar, 0, undefined, false),
    ).toThrow(AnimaeError);
    expect(() =>
      fireTimesInRange(sched({ every: "every fortnight" }), from, to, calendar, 0, undefined, false),
    ).toThrow(AnimaeError);
  });

  test("daily at minute-of-day repeats across days", () => {
    const times = fireTimesInRange(
      sched({ every: "day 8:00" }),
      { day: 1, minute: 0 },
      { day: 3, minute: 0 },
      calendar,
      0,
      undefined,
      false,
    );
    expect(times).toEqual([8 * 60, 1440 + 8 * 60]);
  });

  test("weekly fires only on matching weekday index", () => {
    const cal: Calendar = { ...calendar, weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] };
    const times = fireTimesInRange(
      sched({ every: "week 2 9:00" }),
      { day: 1, minute: 0 },
      { day: 8, minute: 0 },
      cal,
      0,
      undefined,
      false,
    );
    expect(times.length).toBeGreaterThan(0);
    for (const abs of times) {
      const dayIndex = Math.floor(abs / 1440);
      expect(dayIndex % 7).toBe(2);
    }
  });
});

describe("schedule helpers", () => {
  test("parseScheduleDuration passes through item duration", () => {
    expect(parseScheduleDuration(sched({ duration: 90 }), calendar)).toBe(90);
    expect(parseScheduleDuration(sched({}), calendar)).toBeUndefined();
  });

  test("parseEveryIntervalMinutes", () => {
    expect(parseEveryIntervalMinutes("hour", calendar)).toBe(60);
    expect(parseEveryIntervalMinutes("every 5m", calendar)).toBe(5);
    expect(parseEveryIntervalMinutes("day 1:00", calendar)).toBeUndefined();
  });

  test("phase boundaries and current index", () => {
    const started = { day: 1, minute: 100 };
    const bounds = phaseBoundaries(
      [
        { id: "a", minutes: 10 },
        { id: "b", minutes: 20 },
      ],
      started,
      calendar,
    );
    expect(bounds.map((b) => b.phase)).toEqual(["a", "b"]);
    expect(currentPhaseIndex([{ id: "a", minutes: 10 }, { id: "b", minutes: 20 }], started, { day: 1, minute: 105 }, calendar)).toBe(0);
    expect(currentPhaseIndex([{ id: "a", minutes: 10 }, { id: "b", minutes: 20 }], started, { day: 1, minute: 130 }, calendar)).toBe(1);
    expect(currentPhaseIndex([{ id: "a", minutes: 10 }], started, { day: 1, minute: 50 }, calendar)).toBe(-1);
  });
});
