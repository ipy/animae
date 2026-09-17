import { describe, expect, test } from "bun:test";
import { chapterLabel } from "../src/utils/chapter-label.ts";

describe("chapterLabel", () => {
  test("uses the title the engine reports", () => {
    expect(chapterLabel({ id: "ch1", title: "Seeds" })).toBe("Seeds");
  });

  test("falls back to the id without a usable title", () => {
    expect(chapterLabel({ id: "ch1" })).toBe("ch1");
    expect(chapterLabel({ id: "ch1", title: { i18n: { key: "chapter.ch1.title" } } })).toBe("ch1");
    expect(chapterLabel({ id: "ch1", title: "" })).toBe("ch1");
  });

  test("never prints an object", () => {
    expect(chapterLabel({})).toBeUndefined();
    expect(chapterLabel(null)).toBeUndefined();
    expect(chapterLabel(undefined)).toBeUndefined();
  });

  test("still accepts a bare string", () => {
    expect(chapterLabel("Prologue")).toBe("Prologue");
    expect(chapterLabel("")).toBeUndefined();
  });
});
