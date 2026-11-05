import { describe, expect, test } from "bun:test";
import { createTuiFakeEngineControls } from "./helpers/fake-engine.ts";
import { KEYS, mountLiveTui } from "./helpers/live-app-harness.tsx";
import { waitMs } from "./helpers/ink-harness.ts";

const CTRL_P = "\x10";
const BACKSPACE = "\x7f";

const selectedRow = (text: string): string | undefined => text.split("\n").find((line) => line.includes("▸"));

async function openPalette() {
  const { engine } = createTuiFakeEngineControls();
  const tui = mountLiveTui({ engine, scene: { sceneId: "scn_0001" } });
  await waitMs(60);
  await tui.press(CTRL_P);
  expect(await tui.pollUntil((t) => t.includes("Command palette"), 2000)).toBe(true);
  return tui;
}

describe("command palette under fast input", () => {
  test("keys that arrive in the same tick are all applied to the filter", async () => {
    const tui = await openPalette();
    await tui.burst("s", "a", "v", "e");
    expect(await tui.pollUntil((t) => t.includes("Filter: save"), 2000)).toBe(true);
    await tui.burst(BACKSPACE, BACKSPACE, "n", "d");
    expect(await tui.pollUntil((t) => t.includes("Filter: sand"), 2000)).toBe(true);
    await tui.press(KEYS.escape);
    await tui.finish(60);
  });

  test("arrow presses that arrive in the same tick all move the selection, which then stays on the list", async () => {
    const tui = await openPalette();
    const first = selectedRow(tui.getText());
    await tui.burst(KEYS.down, KEYS.down, KEYS.down);
    const third = selectedRow(tui.getText());
    expect(third).toBeDefined();
    expect(third).not.toBe(first);

    // far past the end: the highlight rests on the last entry, and one step up leaves it
    await tui.burst(...Array<string>(80).fill(KEYS.down));
    const last = selectedRow(tui.getText());
    expect(last).not.toBe(third);
    await tui.burst(KEYS.down);
    expect(selectedRow(tui.getText())).toBe(last);
    await tui.press(KEYS.up);
    const beforeLast = selectedRow(tui.getText());
    expect(beforeLast).toBeDefined();
    expect(beforeLast).not.toBe(last);
    await tui.press(KEYS.escape);
    await tui.finish(60);
  });
});
