import { test, expect } from "bun:test";
import { lintAssembledPrompt } from "../../src/pipeline/prompt-lint.ts";

test("lintAssembledPrompt flags common leaks", () => {
  expect(lintAssembledPrompt("ok prompt").length).toBe(0);
  expect(lintAssembledPrompt("$t:cue.action").some((i) => i.code === "UNRESOLVED_STRING_REF")).toBe(true);
  expect(lintAssembledPrompt("{{name:ghost}}").some((i) => i.code === "UNRESOLVED_TEMPLATE")).toBe(true);
  expect(lintAssembledPrompt("<!-- stub -->").some((i) => i.code === "HTML_COMMENT")).toBe(true);
  expect(lintAssembledPrompt("cut truncated to segment budget here").some((i) => i.code === "TRUNCATION_MARKER")).toBe(true);
  expect(lintAssembledPrompt('track.delta: {"kind":"track.delta"}').some((i) => i.code === "RAW_EVENT_JSON")).toBe(true);
  expect(lintAssembledPrompt("scene scn_0001").some((i) => i.code === "INTERNAL_ID")).toBe(true);
  expect(lintAssembledPrompt("你好  世界").some((i) => i.code === "CJK_SPACE")).toBe(true);
});
