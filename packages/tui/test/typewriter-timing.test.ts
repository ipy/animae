import { test, expect } from "bun:test";
import { nextTypewriterTick, typewriterDelayMs } from "../src/utils/typewriter-timing.ts";

test("typewriter delay scales with cps", () => {
  expect(typewriterDelayMs(1, 60)).toBe(Math.ceil(1000 / 60));
});

test("nextTypewriterTick advances until done", () => {
  const step = nextTypewriterTick(0, 3, 100);
  expect("visible" in step && step.visible).toBe(1);
  expect(nextTypewriterTick(3, 3, 100)).toEqual({ done: true });
});
