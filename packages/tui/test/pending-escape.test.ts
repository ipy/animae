import { expect, test } from "bun:test";
import { createInputParser } from "../src/ink/vendor/input-parser.js";
import { parseKeypress } from "../src/ink/parse-keypress.ts";

test("lone ESC is flushed as escape key (Ink-compatible)", () => {
  const parser = createInputParser();
  const events = parser.push("\u001b");
  expect(events.length).toBe(0);
  expect(parser.hasPendingEscape()).toBe(true);
  const flushed = parser.flushPendingEscape();
  expect(flushed).toBe("\u001b");
  expect(parseKeypress(flushed!).name).toBe("escape");
});

test("pending ESC + SS3 suffix becomes function key (not escape then letters)", () => {
  const parser = createInputParser();
  expect(parser.push("\u001b")).toEqual([]);
  const events = parser.push("OP");
  expect(events).toEqual(["\u001bOP"]);
  expect(parseKeypress(events[0] as string).name).toBe("f1");
});
