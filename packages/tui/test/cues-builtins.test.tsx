import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "ink";
import { builtinCueRenderers, expressionLabel } from "../src/cues/builtins.tsx";
import { testCueCtx } from "./helpers/cue-test.ts";

describe("builtin cues", () => {
  test("expression cue visible after offset", () => {
    const node = builtinCueRenderers.expression!(
      { type: "expression", args: { name: "smile" }, at: 2 },
      testCueCtx({ visibleChars: 3, speaker: "mira", totalChars: 10 }),
    );
    expect(renderToString(createElement(() => node))).toContain("smile");
    expect(
      builtinCueRenderers.expression!(
        { type: "expression", args: { name: "smile" }, at: 5 },
        testCueCtx({ visibleChars: 1, speaker: "mira", totalChars: 10 }),
      ),
    ).toBeNull();
  });

  test("action and sfx cues", () => {
    const action = builtinCueRenderers.action!(
      { type: "action", args: { text: "waves" }, at: 0 },
      testCueCtx({ visibleChars: 10, speaker: "mira", totalChars: 10 }),
    );
    expect(renderToString(createElement(() => action))).toContain("waves");
    const sfx = builtinCueRenderers.sfx!(
      { type: "sfx", args: { name: "door" }, at: 0 },
      testCueCtx({ visibleChars: 5, speaker: "mira", totalChars: 10 }),
    );
    expect(renderToString(createElement(() => sfx))).toContain("door");
  });

  test("expressionLabel picks first visible expression", () => {
    const label = expressionLabel(
      [
        { type: "expression", args: { name: "grin" }, at: 0 },
        { type: "expression", args: { id: "wink" }, at: 0 },
      ],
      1,
    );
    expect(label).toBe("grin");
  });
});
