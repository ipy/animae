import { expect, test } from "bun:test";
import { AnimaeError } from "../../src/types.ts";
import { parseDurationMinutes } from "../../src/world/duration.ts";

test("parseDuration table", () => {
  expect(parseDurationMinutes(45)).toBe(45);
  expect(parseDurationMinutes("90m")).toBe(90);
  expect(parseDurationMinutes("2h")).toBe(120);
  expect(parseDurationMinutes("1d")).toBe(1440);
  expect(parseDurationMinutes("1d2h30m")).toBe(1440 + 120 + 30);
  expect(parseDurationMinutes("30")).toBe(30);
  expect(parseDurationMinutes({ hours: 1, minutes: 15 })).toBe(75);
});

test("parseDuration rejects malformed and negative", () => {
  expect(() => parseDurationMinutes("-1")).toThrow(AnimaeError);
  expect(() => parseDurationMinutes("1x")).toThrow(AnimaeError);
  expect(() => parseDurationMinutes("")).toThrow(AnimaeError);
  expect(() => parseDurationMinutes({ minutes: -1 })).toThrow(AnimaeError);
});
