import { describe, expect, test } from "bun:test";
import {
  columnAtGraphemeIndex,
  deleteGraphemeAfter,
  deleteGraphemeBefore,
  graphemeIndexAtColumn,
  insertAtGrapheme,
  wrapToWidth,
} from "../src/utils/display-width.ts";

describe("display-width editing helpers", () => {
  test("graphemeIndexAtColumn and columnAtGraphemeIndex", () => {
    expect(graphemeIndexAtColumn("a中b", 3)).toBe(2);
    expect(columnAtGraphemeIndex("a中b", 2)).toBe(3);
  });

  test("insert and delete graphemes", () => {
    expect(insertAtGrapheme("ab", 1, "Z")).toBe("aZb");
    expect(deleteGraphemeBefore("a中b", 2)).toEqual({ text: "ab", cursor: 1 });
    expect(deleteGraphemeAfter("abc", 1)).toBe("ac");
  });

  test("wrapToWidth splits wide graphemes", () => {
    const lines = wrapToWidth("emoji🎉x", 3);
    expect(lines.length).toBeGreaterThan(1);
  });
});
