import { describe, expect, test } from "bun:test";
import { createTuiFakeEngineControls } from "./helpers/fake-engine.ts";
import { KEYS, mountTui } from "./helpers/app-harness.tsx";
import { waitMs } from "./helpers/ink-harness.ts";

function app() {
  const controls = createTuiFakeEngineControls({}, { models: { s2Tiers: [{ id: "std", model: "m", tags: [] }], s2Default: "std" } });
  return { ...controls, tui: mountTui({ engine: controls.engine }) };
}

describe("TuiApp overlays and input", () => {
  test("F1–F5 open help, event log, timeline, explain, inspector", async () => {
    const { tui } = app();
    await waitMs(50);
    await tui.press(KEYS.f1);
    let text = (await tui.finish(20)).join("\n");
    expect(text).toContain("Help (F1)");

    const ev = app();
    await waitMs(50);
    await ev.tui.press(KEYS.f2);
    expect((await ev.tui.finish(20)).join("\n")).toContain("Event log (F2)");

    const tl = app();
    await waitMs(50);
    await tl.tui.press(KEYS.f3);
    expect((await tl.tui.finish(20)).join("\n")).toContain("Timeline (F3)");

    const ex = app();
    await waitMs(50);
    await ex.tui.press(KEYS.f4);
    expect((await ex.tui.finish(20)).join("\n")).toContain("Explain (F4)");

    const ins = app();
    await waitMs(50);
    await ins.tui.press(KEYS.f5);
    expect((await ins.tui.finish(20)).join("\n")).toContain("Inspector (F5)");
  });

  test("submits a turn and shows model text", async () => {
    const { tui } = app();
    await waitMs(50);
    await tui.type("hello");
    await tui.press(KEYS.enter);
    const frame = await tui.finish(120);
    expect(frame.join("\n")).toContain("Bonjour");
  });

  test("too-small layout below minimum size", async () => {
    const controls = createTuiFakeEngineControls();
    const tui = mountTui({ engine: controls.engine }, { columns: 60, rows: 18 });
    await waitMs(40);
    expect((await tui.finish()).join("\n")).toContain("Please enlarge your terminal");
  });

  test(":query prints JSON in transcript", async () => {
    const { tui } = app();
    await waitMs(50);
    await tui.type(":query player world/time");
    await tui.press(KEYS.enter);
    const frame = await tui.finish(80);
    expect(frame.join("\n")).toContain("08:00");
  });

  test("Esc closes help overlay", async () => {
    const { tui } = app();
    await waitMs(50);
    await tui.press(KEYS.f1, KEYS.escape);
    const frame = await tui.finish(40);
    expect(frame.join("\n")).not.toContain("Help (F1)");
  });

  test("Ctrl+P opens palette and Enter runs filtered command", async () => {
    const { tui } = app();
    await waitMs(50);
    await tui.press("\x10");
    await tui.type("save");
    await tui.press(KEYS.enter);
    const frame = await tui.finish(100);
    expect(frame.join("\n")).toContain("Saved");
  });

  test(":quit closes the engine", async () => {
    let closed = false;
    const controls = createTuiFakeEngineControls({
      close: async () => {
        closed = true;
      },
    });
    const tui = mountTui({ engine: controls.engine });
    await waitMs(50);
    await tui.type(":quit");
    await tui.press(KEYS.enter);
    await tui.finish(80);
    expect(closed).toBe(true);
  });

  test("typing during typewriter skips to full utterance", async () => {
    const { tui } = app();
    await waitMs(50);
    await tui.type("hello");
    await tui.press(KEYS.enter);
    await waitMs(30);
    await tui.press(" ");
    const frame = await tui.finish(150);
    expect(frame.join("\n")).toContain("Bonjour");
  });
});
