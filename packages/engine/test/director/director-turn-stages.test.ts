import { expect, test } from "bun:test";
import { buildTestKernel, minimalAuthored } from "../helpers/fake-kernel.ts";
import { hasVerbatimEcho } from "../../src/director/sidenotes.ts";
import type { FieldDef } from "../../src/schema/authored.ts";

/** The fake kernel's clock starts on day 1 at minute 480; a scene is 30 minutes, a turn 1. */

const never = { kind: "character_choice", spec: { character: "player", choice: "never" } } as const;

function worldField(id: string, level: FieldDef["level"], pressure: number): FieldDef {
  return {
    id,
    holder: { kind: "world" },
    source: "author",
    scope: {},
    level,
    effects: { world_vars: { pressure } },
    priority: 0,
    stacking: "add",
  };
}

const stageOf = (e: { kind: string }): string | undefined => (e as { stage?: string }).stage;

test("force strategy grants the force field on the last turn before the deadline, once", async () => {
  const force = worldField("force-f", "L2", 2);
  const k = buildTestKernel(
    minimalAuthored({
      fields: { "force-f": force },
      anchors: [{ id: "af", force, target: never, deadline: { day: 1, minute: 500 }, strategies: ["force"], hard: [], refs: [] }],
    }),
  );

  const first = await k.director.tick("turn_start");
  expect(first.granted).toEqual(["force-f"]);
  const progress = first.events.filter((e) => e.kind === "anchor.progress");
  expect(progress.map(stageOf)).toEqual(["force"]);
  expect(k.timeline.state().anchors.af?.status).toBe("forced");
  expect(k.timeline.events().filter((e) => e.kind === "field.granted")).toHaveLength(1);

  // A forced anchor is not forced again on the next tick.
  const second = await k.director.tick("turn_start");
  expect(second.granted).toEqual([]);
  expect(second.events.filter((e) => e.kind === "anchor.progress")).toEqual([]);
  expect(k.timeline.events().filter((e) => e.kind === "field.granted")).toHaveLength(1);
});

test("force strategy waits until the deadline is within a scene and a turn", async () => {
  const force = worldField("force-f", "L2", 2);
  const k = buildTestKernel(
    minimalAuthored({
      fields: { "force-f": force },
      anchors: [{ id: "af", force, target: never, deadline: { day: 1, minute: 700 }, strategies: ["force"], hard: [], refs: [] }],
    }),
  );
  const tick = await k.director.tick("turn_start");
  expect(tick.granted).toEqual([]);
  expect(tick.events.filter((e) => e.kind === "anchor.progress")).toEqual([]);
  expect(k.timeline.state().anchors.af).toEqual({ status: "pending", progress: [] });
});

test("force strategy without a force field still reports the stage and grants nothing", async () => {
  const k = buildTestKernel(
    minimalAuthored({
      anchors: [{ id: "af", target: never, deadline: { day: 1, minute: 500 }, strategies: ["force"], hard: [], refs: [] }],
    }),
  );
  const tick = await k.director.tick("turn_start");
  expect(tick.granted).toEqual([]);
  expect(tick.events.filter((e) => e.kind === "anchor.progress").map(stageOf)).toEqual(["force"]);
  expect(k.timeline.events().some((e) => e.kind === "field.granted")).toBe(false);
});

test("a passed deadline without the hard strategy is reported once as stage hard", async () => {
  const k = buildTestKernel(
    minimalAuthored({
      anchors: [{ id: "ah", target: never, deadline: { day: 1, minute: 470 }, strategies: ["soft"], hard: [], refs: [] }],
    }),
  );
  const first = await k.director.tick("turn_start");
  expect(first.events.filter((e) => e.kind === "anchor.progress").map(stageOf)).toEqual(["hard"]);
  expect(first.events.some((e) => e.kind === "anchor.fallback")).toBe(false);
  expect(k.timeline.state().anchors.ah?.status).toBe("hard");

  await k.director.tick("turn_start");
  await k.director.tick("turn_start");
  expect(k.timeline.state().anchors.ah?.progress).toEqual(["hard"]);
  expect(k.timeline.events().filter((e) => e.kind === "anchor.progress")).toHaveLength(1);
});

test("entering a beat grants that beat's fields once", async () => {
  const beatField = worldField("beat-f", "L0", 1);
  const k = buildTestKernel(
    minimalAuthored({
      fields: { "beat-f": beatField },
      beats: [{ id: "b1", enter: "true", exit: "false", fields: ["beat-f"] }],
    }),
  );
  const first = await k.director.tick("scene_start");
  expect(first.granted).toEqual(["beat-f"]);
  expect(first.events.filter((e) => e.kind === "beat.entered")).toHaveLength(1);
  const grants = k.timeline.events().filter((e) => e.kind === "field.granted");
  expect(grants).toHaveLength(1);
  expect((grants[0] as { source?: string }).source).toBe("beat");

  const second = await k.director.tick("scene_start");
  expect(second.granted).toEqual([]);
  expect(k.timeline.events().filter((e) => e.kind === "field.granted")).toHaveLength(1);
});

test("a beat that names an unknown field enters without granting anything", async () => {
  const k = buildTestKernel(
    minimalAuthored({
      beats: [{ id: "b1", enter: "true", exit: "false", fields: ["missing-field"] }],
    }),
  );
  const tick = await k.director.tick("scene_start");
  expect(tick.granted).toEqual([]);
  expect(tick.events.filter((e) => e.kind === "beat.entered")).toHaveLength(1);
  expect(k.timeline.events().some((e) => e.kind === "field.granted")).toBe(false);
});

test("a sidenote counts as echoed only when a run of at least eight of its characters appears in the reply", () => {
  expect(hasVerbatimEcho("the vault key is hidden", "She talked about something else entirely.")).toBe(false);
  expect(hasVerbatimEcho("the vault key is hidden", "I know the vault key is hidden somewhere.")).toBe(true);
  expect(hasVerbatimEcho("the vault key is hidden", "only a vault is mentioned")).toBe(false);
  expect(hasVerbatimEcho("vault key", "a vault key was found", 9)).toBe(true);
  expect(hasVerbatimEcho("vault key", "a vault key was found", 10)).toBe(false);
});
