import { test, expect } from "bun:test";
import { parseKeypress } from "../src/ink/parse-keypress.ts";

test("parseKeypress resolves return and printable keys", () => {
  expect(parseKeypress("\r").name).toBe("return");
  expect(parseKeypress("\n").name).toBe("enter");
  const letter = parseKeypress("a");
  expect(letter.sequence).toBe("a");
  expect(letter.ctrl).toBe(false);
});

test("parseKeypress resolves ctrl+c", () => {
  const k = parseKeypress("\u0003");
  expect(k.name).toBe("c");
  expect(k.ctrl).toBe(true);
});

test("parseKeypress resolves ctrl+z", () => {
  const k = parseKeypress("\u001a");
  expect(k.name).toBe("z");
  expect(k.ctrl).toBe(true);
});
