import { test, expect } from "bun:test";
import { selectLayoutMode } from "../src/utils/layout-mode.ts";

test("selectLayoutMode thresholds", () => {
  expect(selectLayoutMode(120, 30)).toBe("two-column");
  expect(selectLayoutMode(90, 30)).toBe("single-column");
  expect(selectLayoutMode(70, 30)).toBe("too-small");
  expect(selectLayoutMode(90, 20)).toBe("too-small");
});
