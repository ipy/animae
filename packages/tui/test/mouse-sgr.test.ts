import { expect, test } from "bun:test";
import { parseSgrMouseChunk } from "../src/input/mouse-sgr.ts";

test("SGR mouse parses press and release", () => {
  const press = parseSgrMouseChunk("", "\u001b[<0;12;5M");
  expect(press.events.length).toBe(1);
  expect(press.events[0]!.col).toBe(12);
  expect(press.events[0]!.row).toBe(5);
  expect(press.events[0]!.kind).toBe("press");
  expect(press.events[0]!.button).toBe("left");

  const release = parseSgrMouseChunk("", "\u001b[<0;12;5m");
  expect(release.events[0]!.kind).toBe("release");
});

test("SGR mouse wheel and fragmented chunks", () => {
  const w = parseSgrMouseChunk("", "\u001b[<64;3;10M");
  expect(w.events[0]!.button).toBe("wheelUp");

  const part1 = parseSgrMouseChunk("", "\u001b[<0;1");
  expect(part1.pending).toContain("\u001b[<");
  expect(part1.events.length).toBe(0);

  const part2 = parseSgrMouseChunk(part1.pending, ";2M");
  expect(part2.events.length).toBe(1);
  expect(part2.events[0]!.col).toBe(1);
  expect(part2.events[0]!.row).toBe(2);
});

test("SGR mouse ignores garbage and passes rest", () => {
  const r = parseSgrMouseChunk("", "hello\u001b[<0;4;4Mx");
  expect(r.rest).toContain("hello");
  expect(r.rest).toContain("x");
  expect(r.events.length).toBe(1);
});

test("SGR mouse modifiers", () => {
  const r = parseSgrMouseChunk("", "\u001b[<4;1;1M");
  expect(r.events[0]!.shift).toBe(true);
});
