import { afterEach, describe, expect, test } from "bun:test";
import type { Engine, SceneId } from "@animae/engine";
import {
  openRuleEngine,
  startScene,
  type RuleEngineHandle,
} from "../../../engine/test/helpers/rule-fixture.ts";
import { emitPreparsedMouse } from "../../src/input/preparsed-mouse-bus.ts";
import { KEYS, mountLiveTui, openRuleScene } from "../helpers/live-app-harness.tsx";
import { stripAnsi, waitMs } from "../helpers/ink-harness.ts";
import { eventually, submitted, THANKS_REPLY } from "../helpers/engine-e2e.ts";
import { createElement } from "react";
import { TuiApp } from "../../src/app/TuiApp.tsx";
import { renderTuiToString } from "../helpers/render-tui-string.tsx";

function rowsOf(text: string): string[] {
  return stripAnsi(text).split("\n").map((r) => r.trimEnd());
}

describe("TuiApp with rule engine (e2e)", () => {
  let handle: RuleEngineHandle | undefined;
  let sceneId: SceneId | undefined;
  let tui: ReturnType<typeof mountLiveTui> | undefined;

  afterEach(async () => {
    tui?.unmount();
    tui = undefined;
    if (handle) await handle.dispose();
    handle = undefined;
    sceneId = undefined;
  });

  async function boot(opts?: { engine?: Engine; scene?: SceneId }) {
    handle = await openRuleEngine();
    sceneId = opts?.scene ?? (await startScene(handle.engine));
    const engine = opts?.engine ?? handle.engine;
    tui = mountLiveTui(
      { engine, scene: { sceneId }, mouse: true },
      { columns: 120, rows: 40 },
    );
    await waitMs(80);
  }

  test("player turn shows input line and rule-backed reply in transcript", async () => {
    await boot();
    await tui!.type("hello there");
    await tui!.press(KEYS.enter);
    expect(
      await tui!.pollUntil(
        (t) => t.includes("hello there") && t.includes("Aria nods"),
        4500,
      ),
    ).toBe(true);
    const lines = await tui!.finish(120);
    expect(lines.some((l) => l.includes("hello there"))).toBe(true);
    expect(lines.some((l) => l.includes("Aria nods"))).toBe(true);
    expect(await submitted(handle!.engine)).toEqual(["hello there"]);
  });

  test("choices submit via Enter and digit key", async () => {
    await boot();
    await tui!.type("hello");
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes("Thank her"), 2500)).toBe(true);

    // Enter confirms the highlighted option (the first one).
    await tui!.press(KEYS.enter);
    expect(await eventually(async () => (await submitted(handle!.engine)).length === 2)).toBe(true);
    expect(await tui!.pollUntil((t) => THANKS_REPLY.test(t), 2500)).toBe(true);

    // The menu is offered again after the reply; a digit picks the second option.
    expect(await tui!.pollUntil((t) => t.includes("2. Ask about the rain."), 2500)).toBe(true);
    await tui!.press("2");
    expect(await eventually(async () => (await submitted(handle!.engine)).length === 3)).toBe(true);
    expect(await submitted(handle!.engine)).toEqual(["hello", "choice:c1", "choice:c2"]);
    await tui!.finish(80);
  });

  test("choice row accepts preparsed mouse press", async () => {
    await boot();
    await tui!.type("hello");
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes("Thank her"), 2500)).toBe(true);
    const choiceRow = tui!.getLines().findIndex((l) => l.includes("Thank her"));
    expect(choiceRow).toBeGreaterThan(0);
    emitPreparsedMouse({
      kind: "press",
      button: "left",
      col: 8,
      row: choiceRow + 1,
      shift: false,
      alt: false,
      ctrl: false,
      rawButton: 0,
    });
    emitPreparsedMouse({
      kind: "release",
      button: "left",
      col: 8,
      row: choiceRow + 1,
      shift: false,
      alt: false,
      ctrl: false,
      rawButton: 0,
    });
    expect(await eventually(async () => (await submitted(handle!.engine)).length === 2)).toBe(true);
    expect(await submitted(handle!.engine)).toEqual(["hello", "choice:c1"]);
    expect(await tui!.pollUntil((t) => THANKS_REPLY.test(t), 2500)).toBe(true);
    await tui!.finish(60);
  });

  test("command palette opens on Ctrl+P and runs save", async () => {
    await boot();
    expect(await handle!.engine.timeline.saves()).toEqual([]);
    await tui!.press("\x10");
    expect(await tui!.pollUntil((t) => t.includes("Command palette"), 2000)).toBe(true);
    await tui!.type("save");
    expect(await tui!.pollUntil((t) => t.includes("Filter: save"), 2000)).toBe(true);
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => /Saved save_\d+ @ evt_\d+/.test(t), 3500)).toBe(true);
    expect(tui!.getText()).not.toContain("Command palette");
    const saves = await handle!.engine.timeline.saves();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.branch).toBe("main");
    await tui!.finish(80);
  });

  test("F1 opens the help overlay and Escape closes it", async () => {
    await boot();
    await tui!.press(KEYS.f1);
    expect(await tui!.pollUntil((t) => t.includes("Help (F1)") && t.includes("Commands: :save"), 2000)).toBe(true);
    await tui!.press(KEYS.escape);
    expect(await tui!.pollUntil((t) => !t.includes("Help (F1)"), 2000)).toBe(true);
    await tui!.finish(60);
  });

  test(":query inspector overlay and :help notify", async () => {
    await boot();
    await tui!.type(":query player world/time");
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes('"minute": 480'), 3500)).toBe(true);

    await tui!.press(KEYS.f5);
    expect(await tui!.pollUntil((t) => t.includes("Inspector (F5)"), 2000)).toBe(true);
    expect(tui!.getText()).toContain("viewer=player");
    expect(tui!.getText()).toContain('"tavern"');
    await tui!.press(KEYS.escape);
    expect(await tui!.pollUntil((t) => !t.includes("Inspector ("), 2000)).toBe(true);

    await tui!.type(":help");
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes(":rewind <eventId> :branches"), 2500)).toBe(true);
    await tui!.finish(80);
  });

  test(":lang reports the new UI language and rejects a missing argument", async () => {
    await boot();
    await tui!.type(":lang en");
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes("UI language set to en"), 2500)).toBe(true);
    await tui!.type(":lang");
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes("Usage: :lang <locale>"), 2500)).toBe(true);
    await tui!.finish(60);
  });

  test(":quit closes engine", async () => {
    await boot();
    let closed = false;
    const base = handle!.engine;
    handle!.engine = {
      ...base,
      close: async () => {
        closed = true;
        await base.close();
      },
    };
    tui!.unmount();
    tui = mountLiveTui({ engine: handle!.engine, scene: { sceneId: sceneId! } });
    await waitMs(60);
    await tui.type(":quit");
    await tui.press(KEYS.enter);
    expect(await eventually(async () => closed, 2000)).toBe(true);
    tui.unmount();
    tui = undefined;
  });

  test("narrow terminal shows too-small layout without overlapping panes", async () => {
    handle = await openRuleEngine();
    sceneId = await openRuleScene(handle.engine);
    const stdout = { columns: 60, rows: 18, isTTY: true };
    const frame = rowsOf(
      renderTuiToString(
        createElement(TuiApp, {
          engine: handle.engine,
          scene: { sceneId },
          mouse: false,
          stdout: stdout as never,
        }),
        stdout,
      ),
    );
    expect(frame.join("\n")).toContain("Please enlarge your terminal");
    expect(frame.length).toBeLessThanOrEqual(20);
  });

  test("resize keeps layout within terminal rows", async () => {
    await boot();
    await tui!.type("resize check");
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes("resize check"), 4500)).toBe(true);
    tui!.resize({ columns: 100, rows: 40 });
    await waitMs(100);
    tui!.resize({ columns: 88, rows: 30 });
    await waitMs(100);
    const lines = await tui!.finish(80);
    expect(lines.length).toBeLessThanOrEqual(40);
    expect(lines.some((l) => l.includes("resize check"))).toBe(true);
  });

  test("turn error shows message and a follow-up turn succeeds", async () => {
    await boot();
    const base = handle!.engine;
    const origTurn = base.scene.turn.bind(base.scene);
    let failOnce = true;
    base.scene.turn = async function* (...args: Parameters<typeof origTurn>) {
      if (failOnce) {
        failOnce = false;
        throw new Error("engine-turn-fail");
      }
      yield* origTurn(...args);
    };

    await tui!.type("will fail");
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => t.includes("engine-turn-fail"), 3500)).toBe(true);

    await tui!.type("thank you");
    await tui!.press(KEYS.enter);
    expect(await tui!.pollUntil((t) => THANKS_REPLY.test(t), 4500)).toBe(true);
    const lines = await tui!.finish(120);
    expect(lines.some((l) => l.includes("engine-turn-fail"))).toBe(true);
    expect(lines.some((l) => THANKS_REPLY.test(l))).toBe(true);
    expect(await submitted(handle!.engine)).toEqual(["thank you"]);
  });
});
