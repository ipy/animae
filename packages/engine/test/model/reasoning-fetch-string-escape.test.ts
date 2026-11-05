import { test, expect } from "bun:test";
import { extractJsonObjectFromText } from "../../src/model/reasoning-fetch.ts";

test("extractJsonObjectFromText handles escaped quotes inside strings", () => {
  const raw = 'prefix {"msg":"say \\"hi\\""} suffix';
  expect(extractJsonObjectFromText(raw)).toBe('{"msg":"say \\"hi\\""}');
});
