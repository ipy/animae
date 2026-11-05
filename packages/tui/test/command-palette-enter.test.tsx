import { describe, expect, test } from "bun:test";
import { createTuiFakeEngineControls } from "./helpers/fake-engine.ts";
import { KEYS, mountLiveTui } from "./helpers/live-app-harness.tsx";
import { waitMs } from "./helpers/ink-harness.ts";

describe("CommandPalette enter activation", () => {
  test("Enter on save entry runs timeline.save", async () => {
    let saved = false;
    const { engine } = createTuiFakeEngineControls({
      timeline: {
        ...createTuiFakeEngineControls().engine.timeline,
        save: async () => {
          saved = true;
          return { label: "slot-a", branch: "main", eventId: "evt_x", createdAt: new Date().toISOString() };
        },
      },
    });
    const tui = mountLiveTui({ engine, scene: { sceneId: "scn_0001" } });
    await waitMs(60);
    await tui.press("\x10");
    await tui.type("save");
    await tui.press(KEYS.enter);
    expect(await tui.pollUntil(() => saved, 2500)).toBe(true);
    await tui.finish(60);
  });
});
