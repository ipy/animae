import { test, expect } from "bun:test";
import { createInputParser } from "../src/ink/vendor/input-parser.js";
import { parseKeypress } from "../src/ink/parse-keypress.ts";

test("bulk PTY writes split into per-key events", () => {
  const parser = createInputParser();
  const events = parser.push(":help\n");
  expect(events).toEqual([":help\n"]);
  const keys: string[] = [];
  for (const event of events) {
    if (typeof event !== "string") continue;
    if (event.length <= 1) {
      keys.push(parseKeypress(event).name);
    } else {
      for (const ch of event) {
        keys.push(parseKeypress(ch).name);
      }
    }
  }
  expect(keys.filter(Boolean).slice(-1)[0]).toBe("enter");
});
