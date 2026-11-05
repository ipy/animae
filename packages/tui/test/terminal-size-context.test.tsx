import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { TuiApp } from "../src/app/TuiApp.tsx";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { openRuleEngine, startScene } from "../../engine/test/helpers/rule-fixture.ts";
import { renderTuiToString } from "./helpers/render-tui-string.tsx";

describe("terminal size for layout", () => {
  test("too-small layout when stdout dimensions are below minimum", async () => {
    const handle = await openRuleEngine();
    const sceneId = await startScene(handle.engine);
    const stdout = { columns: 60, rows: 18, isTTY: true };
    const frame = renderTuiToString(
      createElement(TuiApp, {
        engine: handle.engine,
        scene: { sceneId },
        mouse: false,
        stdout: stdout as never,
      }),
      stdout,
    );
    await handle.dispose();
    expect(frame).toContain("Please enlarge your terminal");
  });

  test("fake engine narrow render via stdout prop", () => {
    const stdout = { columns: 70, rows: 20, isTTY: true };
    const frame = renderTuiToString(
      createElement(TuiApp, {
        engine: createTuiFakeEngine(),
        scene: { sceneId: "scn_0001" },
        stdout: stdout as never,
      }),
      stdout,
    );
    expect(frame).toContain("Please enlarge your terminal");
  });
});
