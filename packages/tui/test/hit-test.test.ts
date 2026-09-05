import { expect, test } from "bun:test";
import { hitTestTopmost, pointInRect } from "../src/utils/hit-test.ts";

test("pointInRect respects offsets", () => {
  const rect = { x: 10, y: 5, width: 4, height: 2 };
  expect(pointInRect(11, 5, rect)).toBe(true);
  expect(pointInRect(9, 5, rect)).toBe(false);
});

test("hitTestTopmost picks last registered target", () => {
  const targets = [
    { id: "a", rect: { x: 0, y: 0, width: 10, height: 10 } },
    { id: "b", rect: { x: 2, y: 2, width: 4, height: 4 } },
  ];
  const hit = hitTestTopmost(targets, 3, 3);
  expect(hit?.id).toBe("b");
});
