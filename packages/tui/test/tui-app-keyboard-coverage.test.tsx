import { describe, expect, test } from "bun:test";
import type { TurnChunk } from "@animae/engine";
import { createTuiFakeEngineControls } from "./helpers/fake-engine.ts";
import { KEYS, mountLiveTui } from "./helpers/live-app-harness.tsx";
import { waitMs } from "./helpers/ink-harness.ts";

const PAGE_UP = "\x1b[5~";

/** The row a palette or choice menu marks as selected. */
function selectedRow(text: string): string | undefined {
  return text.split("\n").find((line) => line.includes("▸"));
}

describe("TuiApp keyboard coverage", () => {
  test("choice confirm after turn completes", async () => {
    const turns: { text: string; choiceId?: string }[] = [];
    const { engine } = createTuiFakeEngineControls({
      scene: {
        start: async () => "scn_0001",
        active: () => ({ id: "scn_0001", location: "café", participants: ["player", "mira"], turn: 0 }),
        turn: async function* (opts) {
          turns.push({ text: opts.text ?? "", ...(opts.choiceId ? { choiceId: opts.choiceId } : {}) });
          yield { type: "text", text: opts.choiceId ? "Chosen." : opts.text ?? "", speaker: "player", newUtterance: true };
          yield { type: "text", text: "Reply.", speaker: "npc1", newUtterance: true };
          yield {
            type: "choices",
            choices: [{ id: "c1", text: "Next.", expected_event_type: "chat", tags: [] }],
          };
          yield { type: "done", turnId: `turn_${turns.length}`, events: [] };
        },
        end: async () => ({ sceneId: "scn_0001", turns: 1, events: 1, reflections: [], anchors: [] }),
      },
    });

    const tui = mountLiveTui({ engine, scene: { sceneId: "scn_0001" } });
    await waitMs(60);
    await tui.type("hello");
    await tui.press(KEYS.enter);
    expect(await tui.pollUntil((t) => t.includes("Next."), 3000)).toBe(true);
    expect(turns).toEqual([{ text: "hello" }]);
    await tui.press(KEYS.enter);
    expect(await tui.pollUntil((t) => t.includes("Chosen."), 3000)).toBe(true);
    expect(turns).toEqual([{ text: "hello" }, { text: "", choiceId: "c1" }]);
    await tui.finish(60);
  });

  test("palette arrow keys move the selection and Escape closes it", async () => {
    const { engine } = createTuiFakeEngineControls();
    const tui = mountLiveTui({ engine, scene: { sceneId: "scn_0001" } });
    await waitMs(60);
    await tui.press("\x10");
    expect(await tui.pollUntil((t) => t.includes("Command palette"), 2000)).toBe(true);
    expect(selectedRow(tui.getText())).toContain(":help");
    await tui.press(KEYS.down, KEYS.down);
    expect(selectedRow(tui.getText())).toContain(":load");
    await tui.press(KEYS.up);
    expect(selectedRow(tui.getText())).toContain(":save");
    await tui.press(KEYS.escape);
    expect(await tui.pollUntil((t) => !t.includes("Command palette"), 2000)).toBe(true);
    await tui.finish(60);
  });

  test("Page Up scrolls the transcript back and Page Down returns to the latest line", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${String(i + 1).padStart(2, "0")}.`);
    const { engine } = createTuiFakeEngineControls({
      scene: {
        start: async () => "scn_0001",
        active: () => ({ id: "scn_0001", location: "café", participants: ["player", "mira"], turn: 0 }),
        turn: async function* () {
          for (const text of lines) {
            yield { type: "text", text, speaker: "npc1", newUtterance: true } satisfies TurnChunk;
          }
          yield { type: "done", turnId: "turn_0001", events: [] };
        },
        end: async () => ({ sceneId: "scn_0001", turns: 1, events: 1, reflections: [], anchors: [] }),
      },
    });
    const tui = mountLiveTui({ engine, scene: { sceneId: "scn_0001" } }, { columns: 100, rows: 24 });
    await waitMs(60);
    await tui.type("go");
    await tui.press(KEYS.enter);
    expect(await tui.pollUntil((t) => t.includes("Line 30."), 3000)).toBe(true);
    expect(tui.getText()).not.toContain("Line 01.");
    expect(tui.getText()).not.toContain("Jump to latest");

    await tui.press(PAGE_UP);
    expect(await tui.pollUntil((t) => t.includes("Jump to latest"), 2000)).toBe(true);
    expect(tui.getText()).not.toContain("Line 30.");

    for (let i = 0; i < 8; i++) await tui.press(KEYS.pageDown);
    expect(await tui.pollUntil((t) => t.includes("Line 30.") && !t.includes("Jump to latest"), 2000)).toBe(true);
    await tui.finish(60);
  });
});
