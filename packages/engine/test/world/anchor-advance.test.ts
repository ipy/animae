import { expect, test } from "bun:test";
import type { FieldDef } from "../../src/schema/authored.ts";
import { worldMinutes } from "../../src/timeline/time.ts";
import { createWorldService } from "../../src/world/service.ts";
import { buildTestKernel, minimalAuthored } from "../helpers/fake-kernel.ts";
import { createFakeKernel } from "./fake-kernel.ts";

test("overdue anchor fires on world.advance after time.advanced", async () => {
  const fk = createFakeKernel({
    world: { start: { day: 1, minute: 480 } },
    anchors: [
      {
        id: "deadline-anchor",
        target: { kind: "world_event", spec: { event: "never.happens" } },
        deadline: { day: 1, minute: 600 },
        strategies: ["hard"],
        hard: [
          { kind: "world.var_set", path: "story.fell", value: true },
          { kind: "info_arrival", text: "fallback fired", tags: ["anchor"] },
        ],
        refs: [],
      },
    ],
  });
  await fk.world.advance({ to: { day: 1, minute: 720 } });
  const kinds = fk.events().map((e) => e.kind);
  const advIdx = kinds.lastIndexOf("time.advanced");
  const fallbackIdx = kinds.indexOf("anchor.fallback");
  expect(advIdx).toBeGreaterThanOrEqual(0);
  expect(fallbackIdx).toBeGreaterThan(advIdx);
  expect(fk.state().vars["story.fell"]).toBe(true);
  expect(fk.state().anchors["deadline-anchor"]?.status).toBe("fallback");
});

test("anchor fallback does not repeat on scene_start", async () => {
  const fk = createFakeKernel({
    world: { start: { day: 1, minute: 480 } },
    anchors: [
      {
        id: "once",
        target: { kind: "world_event", spec: { event: "never.happens" } },
        deadline: { day: 1, minute: 540 },
        strategies: ["hard"],
        hard: [{ kind: "world.var_set", path: "once", value: 1 }],
        refs: [],
      },
    ],
  });
  await fk.world.advance({ to: { day: 1, minute: 600 } });
  expect(fk.events().filter((e) => e.kind === "anchor.fallback").length).toBe(1);
  await fk.k.m.director.tick("scene_start");
  expect(fk.events().filter((e) => e.kind === "anchor.fallback").length).toBe(1);
});

test("multi-day jump emits soft then hard in chronological order", async () => {
  const soft: FieldDef = {
    id: "jump-soft",
    holder: { kind: "world" },
    source: "author",
    scope: {},
    level: "L0",
    effects: { world_vars: { soft: 1 } },
    priority: 0,
    stacking: "add",
  };
  const fk = createFakeKernel({
    world: { start: { day: 1, minute: 480 } },
    fields: { "jump-soft": soft },
    anchors: [
      {
        id: "combo",
        soft,
        target: { kind: "world_event", spec: { event: "never.happens" } },
        deadline: { day: 1, minute: 600 },
        strategies: ["soft", "hard"],
        hard: [{ kind: "world.var_set", path: "story.hard", value: true }],
        refs: [],
      },
      {
        id: "later",
        target: { kind: "world_event", spec: { event: "never.happens" } },
        deadline: { day: 3, minute: 600 },
        strategies: ["hard"],
        hard: [{ kind: "world.var_set", path: "story.later", value: true }],
        refs: [],
      },
    ],
  });
  await fk.world.advance({ to: { day: 4, minute: 0 } });
  const combo = fk.events().filter((e) => (e as { anchor?: string }).anchor === "combo");
  const softIdx = combo.findIndex((e) => e.kind === "anchor.progress" && (e as { stage?: string }).stage === "soft");
  const fallbackIdx = combo.findIndex((e) => e.kind === "anchor.fallback");
  expect(softIdx).toBeGreaterThanOrEqual(0);
  expect(fallbackIdx).toBeGreaterThan(softIdx);
  expect(fk.state().vars["story.hard"]).toBe(true);
  expect(fk.state().vars["story.later"]).toBe(true);
  const softEv = combo[softIdx]!;
  expect(worldMinutes(softEv.t)).toBe(600 - 30 + 1);
});

test("beat enter on scene checkpoint during long advance", async () => {
  const authored = minimalAuthored({
    world: {
      player: "player",
      start: { day: 1, minute: 0 },
      calendar: { units: { minute: 1, hour: 60, day: 1440 }, sceneMinutes: 30, turnMinutes: 1, chapters: [{ id: "ch1", days: [1, 14] }] },
      vars: {},
      public_vars: [],
      language: "en",
      factions: {},
    },
    beats: [{ id: "day-two", enter: "time.day >= 2", exit: "false", fields: [], note: "Act 2" }],
  });
  const k = buildTestKernel(authored);
  k.m.introspect = { expireGrants: async () => [] } as unknown as typeof k.m.introspect;
  k.m.world = createWorldService(k);
  await k.m.world.advance({ to: { day: 3, minute: 0 } });
  expect(k.timeline.events().some((e) => e.kind === "beat.entered" && (e as { beat?: string }).beat === "day-two")).toBe(true);
});
