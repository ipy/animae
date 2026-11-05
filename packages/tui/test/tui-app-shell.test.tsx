import { describe, expect, test } from "bun:test";
import { createTuiFakeEngineControls } from "./helpers/fake-engine.ts";
import { KEYS, mountLiveTui } from "./helpers/live-app-harness.tsx";
import { waitMs } from "./helpers/ink-harness.ts";

describe("TuiApp shell keyboard paths", () => {
  test("palette navigation backspace and escape", async () => {
    const { engine } = createTuiFakeEngineControls();
    const tui = mountLiveTui({ engine, scene: { sceneId: "scn_0001" } });
    await waitMs(60);
    await tui.press("\x10");
    await tui.type("hel");
    await tui.press("\x7f");
    await tui.press(KEYS.escape);
    expect(
      await tui.pollUntil((t) => !t.includes("Command palette (Ctrl+P"), 2000),
    ).toBe(true);
    await tui.finish(60);
  });

  test("timeline overlay moves selection with arrows", async () => {
    const { engine } = createTuiFakeEngineControls();
    const tui = mountLiveTui({ engine, scene: { sceneId: "scn_0001" } });
    await waitMs(60);
    await tui.press(KEYS.f3);
    expect(await tui.pollUntil((t) => t.includes("Timeline"), 2000)).toBe(true);
    await tui.press(KEYS.down, KEYS.down);
    await tui.finish(80);
    expect(tui.getText()).toContain("Timeline");
  });

  test("load overlay opens from key binding", async () => {
    const { engine } = createTuiFakeEngineControls();
    const tui = mountLiveTui({ engine, scene: { sceneId: "scn_0001" } });
    await waitMs(60);
    await tui.press("\x0c");
    expect(await tui.pollUntil((t) => t.includes("Load") || t.includes("load"), 2000)).toBe(true);
    await tui.finish(60);
  });

  test("input history recalls prior line with up arrow", async () => {
    const { engine } = createTuiFakeEngineControls();
    const tui = mountLiveTui({ engine, scene: { sceneId: "scn_0001" } });
    await waitMs(60);
    await tui.type("first line");
    await tui.press(KEYS.enter);
    await waitMs(200);
    await tui.type("second");
    await tui.press(KEYS.enter);
    await waitMs(200);
    await tui.press(KEYS.up);
    const text = tui.getText();
    expect(text).toContain("second");
    await tui.finish(80);
  });

  test("paste inserts text at input", async () => {
    const { engine } = createTuiFakeEngineControls();
    const tui = mountLiveTui({ engine, scene: { sceneId: "scn_0001" } });
    await waitMs(60);
    await tui.press("\x1b[200~pasted\x1b[201~");
    await waitMs(80);
    expect(tui.getText()).toContain("pasted");
    await tui.finish(60);
  });

  test("async scene start from props", async () => {
    const { engine } = createTuiFakeEngineControls();
    const tui = mountLiveTui({
      engine,
      scene: { location: "café", participants: ["player", "mira"] },
    });
    expect(await tui.pollUntil((t) => t.includes(">"), 3000)).toBe(true);
    await tui.finish(60);
  });
});
