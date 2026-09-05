import { expect, test } from "bun:test";
import { createFakeKernel } from "./fake-kernel.ts";
import type { RuleFn } from "../../src/contracts.ts";

test("long event phase catch-up across advance", async () => {
  const { world, events, state } = createFakeKernel({
    world: { start: { day: 1, minute: 0 } },
    schedule: [
      {
        id: "fest",
        at: "day 1 08:00",
        duration: 120,
        phases: [
          { id: "setup", minutes: 30 },
          { id: "main", minutes: 60 },
          { id: "teardown", minutes: 30 },
        ],
        emit: { kind: "fest.start" },
      },
    ],
  });
  await world.advance({ to: { day: 1, minute: 600 } });
  const phases = events().filter((e) => e.kind === "longevent.phase");
  expect(phases.length).toBeGreaterThanOrEqual(2);
  expect(state().schedule.fest?.phaseIndex).toBeGreaterThanOrEqual(1);
});

test("interruptLongEvent runs onInterrupt and marks interrupted", async () => {
  const ruleFn: RuleFn = () => [{ kind: "test.interrupted" }];
  const rules = {
    cel: { check: () => undefined, eval: (x: unknown) => x, bool: () => true, num: () => 0, str: (x: unknown) => String(x) },
    register: () => {},
    fn: (name: string) => (name === "stopFest" ? ruleFn : undefined),
    has: (name: string) => name === "stopFest",
    run: () => [],
  };
  const { world, events, state } = createFakeKernel({
    world: { start: { day: 1, minute: 0 } },
    schedule: [
      {
        id: "fest",
        at: "day 1 08:00",
        duration: 120,
        phases: [{ id: "setup", minutes: 120 }],
        onInterrupt: "stopFest",
        emit: { kind: "fest.start" },
      },
    ],
    rules: rules as import("../../src/contracts.ts").RuleEngine,
  });
  await world.advance({ to: { day: 1, minute: 500 } });
  await world.interruptLongEvent("fest");
  expect(events().some((e) => e.kind === "longevent.interrupted")).toBe(true);
  expect(events().some((e) => e.kind === "test.interrupted")).toBe(true);
  expect(state().schedule.fest?.interrupted).toBe(true);
});
