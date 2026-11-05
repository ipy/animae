import { expect, test } from "bun:test";
import { createInputParser } from "../src/ink/vendor/input-parser.js";
import { parseKeypress } from "../src/ink/parse-keypress.ts";
import { matchKeyAction, defaultKeymap } from "../src/keymap/default.ts";

/** Simulate Ink emitting split escape sequences as separate stdin events. */
function parseSplitEvents(chunks: string[]): string[] {
  const parser = createInputParser();
  const names: string[] = [];
  for (const chunk of chunks) {
    for (const event of parser.push(chunk)) {
      if (typeof event !== "string") continue;
      names.push(parseKeypress(event).name);
    }
  }
  if (parser.hasPendingEscape()) {
    const flushed = parser.flushPendingEscape();
    if (flushed) names.push(parseKeypress(flushed).name);
  }
  return names;
}

const SS3_F_KEYS = [
  ["\x1bOP", "f1"],
  ["\x1bOQ", "f2"],
  ["\x1bOR", "f3"],
  ["\x1bOS", "f4"],
] as const;

for (const [seq, name] of SS3_F_KEYS) {
  test(`SS3 ${name} whole sequence ${JSON.stringify(seq)}`, () => {
    expect(parseKeypress(seq).name).toBe(name);
  });
}

test("SS3 f1 split across chunks reassembles (no stray P)", () => {
  expect(parseSplitEvents(["\x1b", "OP"])).toEqual(["f1"]);
});

test("CSI f5 \\x1b[15~", () => {
  expect(parseKeypress("\x1b[15~").name).toBe("f5");
});

test("arrow SS3 \\x1bOA", () => {
  expect(parseKeypress("\x1bOA").name).toBe("up");
});

test("meta+1 opens help overlay binding", () => {
  expect(matchKeyAction(defaultKeymap, "1", "1", { meta: true })).toBe("help");
});

test("fast burst typing string preserved by parser", () => {
  const parser = createInputParser();
  const text = "achievementsé";
  const events = parser.push(text);
  expect(events).toEqual([text]);
});
