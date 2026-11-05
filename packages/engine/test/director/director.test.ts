import { test, expect } from "bun:test";
import { buildTestKernel, minimalAuthored } from "../helpers/fake-kernel.ts";
import { hasVerbatimEcho } from "../../src/director/sidenotes.ts";
import type { FieldDef } from "../../src/schema/authored.ts";

test("sidenote echo 8-char boundary", () => {
  expect(hasVerbatimEcho("short", "this is short enough text")).toBe(false);
  expect(hasVerbatimEcho("12345678", "prefix 12345678 suffix")).toBe(true);
  expect(hasVerbatimEcho("1234567", "xxx1234567xxx")).toBe(false);
});

test("anchor world_event fulfilled", async () => {
  const authored = minimalAuthored({
    anchors: [
      {
        id: "a1",
        target: { kind: "world_event", spec: { event: "schedule.fired" } },
        deadline: { day: 1, minute: 900 },
        strategies: ["soft", "hard"],
        hard: [{ kind: "world.var_set", path: "fail", value: 1 }],
        refs: [],
      },
    ],
  });
  const k = buildTestKernel(authored);
  await k.timeline.append([{ kind: "schedule.fired", id: "s1", at: k.timeline.now() }]);
  const tick = await k.director.tick("turn_start");
  expect(tick.events.some((e) => e.kind === "anchor.fulfilled")).toBe(true);
});

test("anchor info_arrival target", async () => {
  const authored = minimalAuthored({
    anchors: [
      {
        id: "a2",
        target: { kind: "info_arrival", spec: { tags: ["clue"] } },
        deadline: { day: 1, minute: 900 },
        strategies: ["hard"],
        hard: [],
        refs: [],
      },
    ],
  });
  const k = buildTestKernel(authored);
  await k.timeline.append([{ kind: "info_arrival", tags: ["clue"] }]);
  const tick = await k.director.tick("turn_start");
  expect(tick.events.some((e) => e.kind === "anchor.fulfilled")).toBe(true);
});

test("anchor soft field when less than one scene to deadline", async () => {
  const soft: FieldDef = {
    id: "soft-f",
    holder: { kind: "world" },
    source: "author",
    scope: {},
    level: "L0",
    effects: { world_vars: { pressure: 1 } },
    priority: 0,
    stacking: "add",
  };
  const authored = minimalAuthored({
    fields: { "soft-f": soft },
    anchors: [
      {
        id: "a3",
        soft,
        target: { kind: "character_choice", spec: { character: "player", choice: "never" } },
        deadline: { day: 1, minute: 500 },
        strategies: ["soft", "hard"],
        hard: [{ kind: "anchor.fallback", anchor: "a3" }],
        refs: [],
      },
    ],
  });
  const k = buildTestKernel(authored);
  const tick = await k.director.tick("scene_start");
  expect(tick.events.some((e) => e.kind === "anchor.progress" && (e as { stage?: string }).stage === "soft")).toBe(true);
});

test("beats ordering and beatNote", async () => {
  const authored = minimalAuthored({
    beats: [
      { id: "b1", enter: "true", exit: "false", fields: [], note: "Act one" },
      { id: "b2", enter: "false", exit: "false", fields: [] },
    ],
  });
  const k = buildTestKernel(authored);
  await k.director.tick("scene_start");
  expect(k.director.beatNote()).toBe("Act one");
});

test("exception charges and bypass cost", async () => {
  const authored = minimalAuthored({
    exceptions: { ex: { id: "ex", charges: 1, period: "day", mayBypass: ["cost_due"] } },
  });
  const k = buildTestKernel(authored);
  const entry = await k.director.invokeException("ex", "cost_due");
  expect(entry.kind).toBe("exception.used");
  expect(k.director.bypassArmed("cost_due")).toBe(true);
  await expect(k.director.invokeException("ex", "cost_due")).rejects.toThrow(/charges/);
});

test("afterRender sidenote echo event", async () => {
  const k = buildTestKernel(minimalAuthored());
  await k.director.sidenote("npc", "1234567890", { verbatim: false, ttlTurns: 2 });
  await k.director.afterRender("npc", "said 1234567890 today");
  expect(k.timeline.events().some((e) => e.kind === "sidenote.echoed")).toBe(true);
});

test("a sidenote lasts for its ttlTurns turns and lapses when the last of them ends", async () => {
  const k = buildTestKernel(minimalAuthored());
  await k.director.sidenote("npc", "remember the key", { ttlTurns: 2 });
  expect(k.director.sidenotesFor("npc").map((n) => n.text)).toEqual(["remember the key"]);
  await k.timeline.append([{ kind: "turn.ended", turn: "t1" }]);
  expect(k.director.sidenotesFor("npc")).toHaveLength(1);
  await k.timeline.append([{ kind: "turn.ended", turn: "t2" }]);
  expect(k.director.sidenotesFor("npc")).toEqual([]);
});

test("afterRender writes sidenote.expired for the speaker's notes whose lifetime is used up", async () => {
  const k = buildTestKernel(minimalAuthored());
  await k.director.sidenote("npc", "only for this turn", { ttlTurns: 0 });
  await k.director.sidenote("npc", "for a while", { ttlTurns: 3 });
  await k.director.sidenote("other", "someone else's", { ttlTurns: 0 });
  const [spent] = k.director.sidenotesFor("npc");

  await k.director.afterRender("npc", "nothing of the notes is repeated here");
  const expired = k.timeline.events().filter((e) => e.kind === "sidenote.expired") as unknown as { npc: string; noteId: string }[];
  expect(expired.map((e) => [e.npc, e.noteId])).toEqual([["npc", spent!.noteId]]);
  expect(k.director.sidenotesFor("npc").map((n) => n.text)).toEqual(["for a while"]);
  expect(k.director.sidenotesFor("other")).toHaveLength(1);
});
