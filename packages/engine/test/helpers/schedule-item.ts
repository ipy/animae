import type { ScheduleItem } from "../../src/schema/authored.ts";

/** Schedule row with required id plus a noop rule so runtime parse tests type-check. */
export function testScheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: "sched_test",
    rule: "noop",
    ...overrides,
  };
}
