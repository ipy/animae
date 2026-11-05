import { expect, test } from "bun:test";
import {
  anchorDeadlineMinutes,
  anchorNear,
  anchorTargetMet,
  anchorsReferencing,
  activeAnchorStatus,
  ensureForceField,
  ensureSoftField,
  isLastTurnBeforeDeadline,
  isTerminal,
  scenesUntilDeadline,
} from "../../src/director/anchors.ts";
import { exceptionPeriodKey } from "../../src/director/exceptions.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import { buildCelContext } from "../../src/rules/cel-context.ts";
import { minimalPolicy } from "../timeline/fixture.ts";
import { minimalAuthored as baseAuthored } from "../helpers/fake-kernel.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import type { EngineEvent } from "../../src/types.ts";
import { buildTestKernel } from "../helpers/fake-kernel.ts";

test("anchorDeadlineMinutes boolean CEL deadline uses ctx.time", () => {
  const cel = createCelEngine();
  const ctx = buildCelContext(
    {
      state: initialState(baseAuthored(), minimalPolicy()),
      authored: baseAuthored(),
      policy: minimalPolicy(),
      catalog: { character: () => undefined, location: () => undefined, item: () => undefined } as never,
    },
    { self: "player" },
  );
  const anchor = {
    id: "a",
    deadline: "true",
    target: { kind: "world_event" as const, spec: { event: "x" } },
    strategies: ["hard" as const],
    hard: [],
    refs: [],
  };
  const time = ctx.time as { minute: number };
  expect(anchorDeadlineMinutes(anchor, cel, ctx, (t) => t.minute)).toBe(time.minute);
  expect(anchorDeadlineMinutes({ ...anchor, deadline: "false" }, cel, ctx, () => 0)).toBeUndefined();
});

test("anchorDeadlineMinutes from WorldTime, number, and CEL string", () => {
  const cel = createCelEngine();
  const ctx = { time: { day: 1, minute: 480 } };
  const anchor = {
    id: "a",
    deadline: { day: 1, minute: 500 },
    target: { kind: "world_event" as const, spec: { event: "x" } },
    strategies: ["hard" as const],
    hard: [],
    refs: [],
  };
  expect(anchorDeadlineMinutes(anchor, cel, ctx, (t) => (t.day - 1) * 1440 + t.minute)).toBe(480 + 20);
  expect(anchorDeadlineMinutes({ ...anchor, deadline: 600 as unknown as typeof anchor.deadline }, cel, ctx, () => 0)).toBe(600);
  expect(anchorDeadlineMinutes({ ...anchor, deadline: "480 + 10" }, cel, ctx, () => 0)).toBe(490);
});

test("anchorTargetMet character_choice and character_state branches", () => {
  const cel = createCelEngine();
  const authored = baseAuthored();
  const state = initialState(authored, minimalPolicy());
  const ctx = buildCelContext({ state, authored, policy: minimalPolicy(), catalog: { character: () => undefined, location: () => undefined, item: () => undefined } as never }, { self: "player" });
  const events: EngineEvent[] = [
    { id: "e1", kind: "choice.taken", character: "player", choiceId: "opt-a", t: state.time, sid: "s", source: "t", because: [] },
  ];
  expect(
    anchorTargetMet(
      {
        id: "a",
        target: { kind: "character_choice", spec: { character: "player", choice: "opt-a" } },
        deadline: { day: 1, minute: 900 },
        strategies: ["hard"],
        hard: [],
        refs: [],
      },
      events,
      cel,
      ctx,
    ),
  ).toBe(true);
  expect(
    anchorTargetMet(
      {
        id: "b",
        target: { kind: "character_state", spec: { character: "player", when: "true" } },
        deadline: { day: 1, minute: 900 },
        strategies: ["hard"],
        hard: [],
        refs: [],
      },
      [],
      cel,
      ctx,
    ),
  ).toBe(true);
});

test("anchorTargetMet world_event and info_arrival filters", () => {
  const cel = createCelEngine();
  const state = initialState(baseAuthored(), minimalPolicy());
  const ctx = buildCelContext(
    { state, authored: baseAuthored(), policy: minimalPolicy(), catalog: { character: () => undefined, location: () => undefined, item: () => undefined } as never },
    { self: "player" },
  );
  const events: EngineEvent[] = [
    { id: "e1", kind: "rumor.heard", t: state.time, sid: "s", source: "t", because: [] },
    { id: "e2", kind: "info_arrival", knowledge: "doc1", tags: ["urgent"], t: state.time, sid: "s", source: "t", because: [] },
  ];
  expect(
    anchorTargetMet(
      { id: "w", target: { kind: "world_event", spec: { event: "rumor.heard" } }, deadline: { day: 1, minute: 0 }, strategies: [], hard: [], refs: [] },
      events,
      cel,
      ctx,
    ),
  ).toBe(true);
  expect(
    anchorTargetMet(
      { id: "i", target: { kind: "info_arrival", spec: { knowledge: "doc1", tags: ["urgent"] } }, deadline: { day: 1, minute: 0 }, strategies: [], hard: [], refs: [] },
      events,
      cel,
      ctx,
    ),
  ).toBe(true);
});

test("anchorsReferencing, activeAnchorStatus, isTerminal", () => {
  const anchors = [
    { id: "a", target: { kind: "character_choice" as const, spec: { character: "player", choice: "c" } }, deadline: { day: 1, minute: 0 }, strategies: [], hard: [], refs: ["npc1"] },
    { id: "b", target: { kind: "info_arrival" as const, spec: { knowledge: "player" } }, deadline: { day: 1, minute: 0 }, strategies: [], hard: [], refs: [] },
  ];
  expect(anchorsReferencing("npc1", anchors)).toHaveLength(1);
  expect(anchorsReferencing("player", anchors)).toHaveLength(2);
  const st = initialState(baseAuthored(), minimalPolicy());
  expect(activeAnchorStatus(st, "missing").status).toBe("pending");
  expect(isTerminal("fulfilled")).toBe(true);
  expect(isTerminal("pending")).toBe(false);
});

test("scenesUntilDeadline, isLastTurnBeforeDeadline, anchorNear, ensureSoft/Force", () => {
  expect(scenesUntilDeadline(510, 480, 30)).toBeCloseTo(1);
  expect(isLastTurnBeforeDeadline(482, 480, 30, 1)).toBe(true);
  expect(anchorNear(0.5, 1)).toBe(true);
  const soft = ensureSoftField({
    id: "a",
    soft: { id: "soft-f", holder: { kind: "world" }, source: "author", scope: {}, level: "L0", effects: {}, priority: 0, stacking: "add" },
    target: { kind: "world_event", spec: { event: "x" } },
    deadline: { day: 1, minute: 500 },
    strategies: ["soft"],
    hard: [],
    refs: [],
  });
  expect(soft?.id).toBe("soft-f");
  const force = ensureForceField({
    id: "b",
    force: { id: "force-f", holder: { kind: "world" }, source: "author", scope: {}, level: "L2", effects: { intent_force: "talk" }, priority: 0, stacking: "add" },
    target: { kind: "world_event", spec: { event: "x" } },
    deadline: { day: 1, minute: 500 },
    strategies: ["force"],
    hard: [],
    refs: [],
  });
  expect(force?.level).toBe("L2");
  expect(anchorsReferencing("player", [{ id: "x", target: { kind: "character_choice", spec: { character: "player", choice: "c" } }, deadline: { day: 1, minute: 0 }, strategies: [], hard: [], refs: [] }])).toHaveLength(1);
});

test("exceptionPeriodKey for session, day, and chapter", () => {
  const authored = baseAuthored({
    world: {
      ...baseAuthored().world,
      calendar: {
        ...baseAuthored().world.calendar,
        chapters: [{ id: "ch1", days: [1, 2] as [number, number] }],
      },
    },
  });
  const t = { day: 1, minute: 600 };
  expect(exceptionPeriodKey("session", t, "sess_1", authored)).toBe("sess_1");
  expect(exceptionPeriodKey("day", t, "sess_1", authored)).toBe("day:1");
  expect(exceptionPeriodKey("chapter", t, "sess_1", authored)).toBe("chapter:ch1");
  expect(exceptionPeriodKey("chapter", { day: 9, minute: 0 }, "sess_1", authored)).toBe("chapter:none");
  expect(exceptionPeriodKey("week" as never, t, "sess_1", authored)).toBe("sess_1");
});

test("director invokeException charges and mayBypass", async () => {
  const k = buildTestKernel(
    baseAuthored({
      exceptions: { ex: { id: "ex", charges: 2, period: "day", mayBypass: ["field_cap", "cost_due"] } },
    }),
  );
  await k.director.invokeException("ex", "field_cap");
  await k.director.invokeException("ex", "cost_due");
  await expect(k.director.invokeException("ex", "track_cap")).rejects.toThrow(/cannot bypass/);
  expect(k.timeline.state().exceptions.ex?.usedInPeriod).toBe(2);
});
