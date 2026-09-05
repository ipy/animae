import { expect, test } from "bun:test";
import { chapterAt, formatTime, fromMinutes, toMinutes } from "../../src/world/calendar.ts";
import type { Calendar } from "../../src/schema/authored.ts";

const cal: Calendar = {
  units: { minute: 1, hour: 60, day: 1440 },
  sceneMinutes: 30,
  turnMinutes: 1,
  chapters: [{ id: "ch1", days: [1, 7] }, { id: "ch2", days: [8, 14] }],
  weekdays: ["Mon", "Tue", "Wed"],
};

test("calendar formatting and chapters", () => {
  const t = { day: 2, minute: 90 };
  expect(formatTime(t, cal).hhmm).toBe("01:30");
  expect(formatTime(t, cal).weekday).toBe("Tue");
  expect(chapterAt({ day: 8, minute: 0 }, cal)?.id).toBe("ch2");
  expect(chapterAt({ day: 20, minute: 0 }, cal)).toBeUndefined();
});

test("toMinutes round trip", () => {
  const m = toMinutes({ day: 3, minute: 100 }, cal);
  expect(fromMinutes(m, cal)).toEqual({ day: 3, minute: 100 });
});
