import { expect, test } from "bun:test";
import { createFakeKernel, minimalAuthored } from "./fake-kernel.ts";
import type { ScheduleItem } from "../../src/schema/authored.ts";

function sched(items: ScheduleItem[]) {
  return createFakeKernel({ schedule: items });
}

test("advance fires schedule items in chronological order", async () => {
  const { world, events } = sched([
    { id: "b", at: "day 1 09:00", emit: { kind: "test.b" } },
    { id: "a", at: "day 1 08:30", emit: { kind: "test.a" } },
  ]);
  await world.advance("90m");
  const kinds = events().filter((e) => e.kind.startsWith("test.")).map((e) => e.kind);
  expect(kinds).toEqual(["test.a", "test.b"]);
});

test("daily every and hourly semantics", async () => {
  const { world, events } = createFakeKernel({
    world: { start: { day: 1, minute: 0 } },
    schedule: [
      { id: "hourly", every: "hour", emit: { kind: "tick.hour" } },
      { id: "daily", every: "day 08:00", emit: { kind: "tick.day" } },
    ],
  });
  await world.advance({ to: { day: 1, minute: 600 } });
  const fired = events().filter((e) => e.kind === "schedule.fired").map((e) => (e as { id: string }).id);
  expect(fired).toContain("daily");
  expect(fired.filter((id) => id === "hourly").length).toBeGreaterThan(0);
});

test("schedule idempotency via lastFired after reload", async () => {
  const fk = sched([{ id: "once", at: "day 1 09:00", emit: { kind: "test.once" } }]);
  await fk.world.advance({ to: { day: 1, minute: 540 } });
  const countAfterFirst = fk.events().filter((e) => e.kind === "test.once").length;
  expect(countAfterFirst).toBe(1);
  const snap = fk.state();
  fk.reloadState(snap);
  await fk.world.advance({ to: { day: 1, minute: 600 } });
  expect(fk.events().filter((e) => e.kind === "test.once").length).toBe(countAfterFirst);
});

test("schedule_offset shifts fire time", async () => {
  const { authored, policy } = minimalAuthored({
    schedule: [{ id: "ev", at: "day 1 08:00", emit: { kind: "shifted" } }],
    fields: {
      f1: {
        id: "f1",
        holder: { kind: "world" },
        level: "L0",
        effects: { schedule_offset: { ev: 30 } },
        scope: {},
        priority: 0,
        stacking: "add",
        source: "author",
      },
    },
  });
  let state = (await import("../../src/timeline/initial-state.ts")).initialState(authored, policy);
  state.fields.f1 = {
    def: authored.fields.f1!,
    grantedAt: state.time,
    scenesElapsed: 0,
    turnsElapsed: 0,
    source: "runtime",
  };
  const fk = createFakeKernel({ schedule: authored.schedule, fields: authored.fields });
  fk.reloadState(state);
  await fk.world.advance({ to: { day: 1, minute: 510 } });
  const fired = fk.events().find((e) => e.kind === "schedule.fired") as { at: { minute: number } } | undefined;
  expect(fired?.at.minute).toBe(510);
});
