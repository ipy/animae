import { expect, test, describe } from "bun:test";
import {
  extractPlaceholders,
  flattenCatalog,
  formatMessage,
  placeholderSetsMatch,
  unflattenCatalog,
} from "../src/format-message.ts";

describe("formatMessage ICU subset", () => {
  test("simple placeholders and escaping", () => {
    expect(formatMessage("en", "Hi {name}", { name: "Ann" })).toBe("Hi Ann");
    expect(formatMessage("en", "Missing {x}")).toBe("Missing {x}");
    expect(formatMessage("en", "brace {{literal}}")).toBe("brace {literal}");
  });

  test("plural cardinal and =0", () => {
    const pat = "{count, plural, =0 {none} one {# item} other {# items}}";
    expect(formatMessage("en", pat, { count: 0 })).toBe("none");
    expect(formatMessage("en", pat, { count: 1 }).toLowerCase()).toContain("item");
    expect(formatMessage("en", pat, { count: 3 }).toLowerCase()).toContain("items");
  });

  test("exact-value plural keys match any number, ahead of plural categories", () => {
    const pat = "{n, plural, =1 {exactly one} =2 {a pair} one {# item} other {# items}}";
    expect(formatMessage("en", pat, { n: 1 })).toBe("exactly one");
    expect(formatMessage("en", pat, { n: 2 })).toBe("a pair");
    expect(formatMessage("en", pat, { n: 5 })).toBe("5 items");
  });

  test("select and selectordinal", () => {
    const sel = "{gender, select, female {she} male {he} other {they}}";
    expect(formatMessage("en", sel, { gender: "female" })).toBe("she");
    expect(formatMessage("en", sel, { gender: "unknown" })).toBe("they");
    const ord = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
    expect(formatMessage("en", ord, { n: 1 })).toContain("1");
  });

  test("number date and relativeTime", () => {
    expect(formatMessage("en", "{n, number}", { n: 1200.5 })).toContain("1");
    expect(formatMessage("en", "{n, number, currency}", { n: 9 })).toContain("9");
    expect(formatMessage("en", "{n, number, percent}", { n: 0.5 })).toContain("50");
    const d = "2020-06-15T14:30:00Z";
    expect(formatMessage("en", "{d, date}", { d })).toMatch(/2020|Jun|15/);
    expect(formatMessage("en", "{d, date, time}", { d })).toMatch(/:/);
    expect(formatMessage("en", "{d, date, datetime}", { d }).length).toBeGreaterThan(5);
    expect(formatMessage("en", "{v, relativeTime, day}", { v: -1 })).toMatch(/day|yesterday/i);
  });

  test("invalid date falls back to string", () => {
    expect(formatMessage("en", "{d, date}", { d: "not-a-date" })).toBe("not-a-date");
  });

  test("plural fallback uses other branch", () => {
    const pat = "{n, plural, one {# only} other {# many}}";
    expect(formatMessage("en", pat, { n: 99 })).toContain("99");
  });

  test("invalid locale falls back plural category", () => {
    const pat = "{n, plural, one {#} other {#}}";
    expect(formatMessage("not-a-real-locale-tag", pat, { n: 1 })).toBe("1");
  });

  test("unknown format keeps placeholder", () => {
    expect(formatMessage("en", "{x, weird}", { x: 1 })).toBe("1");
    expect(formatMessage("en", "{x, weird}")).toBe("{x, weird}");
  });
});

test("catalog flatten helpers", () => {
  const nested = { a: { b: "v" }, c: "x" };
  const flat = flattenCatalog(nested);
  expect(flat).toEqual({ "a.b": "v", c: "x" });
  expect(unflattenCatalog(flat)).toEqual(nested);
});

test("placeholder extraction parity", () => {
  const a = "{n, number} and {name}";
  expect(extractPlaceholders(a)).toEqual(["n", "name"]);
  expect(placeholderSetsMatch(a, "{name} {n, number}")).toBe(true);
  expect(placeholderSetsMatch(a, "{name}")).toBe(false);
});
