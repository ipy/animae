import { expect, test } from "bun:test";
import { hitTestTopmost, metricsToRect, pointInRect } from "../src/utils/hit-test.ts";

test("metricsToRect copies ink metrics", () => {
  const rect = metricsToRect({ x: 2, y: 3, width: 10, height: 4, clientWidth: 10, clientHeight: 4 });
  expect(rect).toEqual({ x: 2, y: 3, width: 10, height: 4 });
});

test("hitTestTopmost returns undefined when nothing hits", () => {
  const hit = hitTestTopmost([{ rect: { x: 0, y: 0, width: 1, height: 1 } }], 9, 9);
  expect(hit).toBeUndefined();
});

test("pointInRect with offsets excludes edge", () => {
  expect(pointInRect(5, 5, { x: 10, y: 10, width: 2, height: 2 }, 0, 0)).toBe(false);
});
