import { describe, expect, test } from "bun:test";
import { adaptCelContext, adaptCelResult, celCheck, createCelEngine } from "../../src/rules/cel.ts";
import { AnimaeError } from "../../src/types.ts";

const cel = createCelEngine();

function failure(run: () => unknown): AnimaeError {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(AnimaeError);
    expect((e as AnimaeError).code).toBe("CEL_EVAL");
    return e as AnimaeError;
  }
  throw new Error("the expression was expected to fail");
}

describe("helper functions", () => {
  test("abilityMod rounds the score offset down to a whole modifier", () => {
    const mods = [1, 7, 8, 9, 10, 11, 12, 15, 20].map((score) => cel.num(`abilityMod(${score})`, {}));
    expect(mods).toEqual([-5, -2, -1, -1, 0, 0, 1, 2, 5]);
  });

  test("profBonus grows by one every four levels from +2", () => {
    const bonus = [1, 4, 5, 8, 9, 13, 17, 20].map((level) => cel.num(`profBonus(${level})`, {}));
    expect(bonus).toEqual([2, 2, 3, 3, 4, 5, 6, 6]);
  });

  test("maxInt picks the larger integer", () => {
    expect(cel.num("maxInt(3, 7)", {})).toBe(7);
    expect(cel.num("maxInt(-3, -7)", {})).toBe(-3);
    expect(cel.num("maxInt(tracks.a, 10)", { tracks: { a: 12 } })).toBe(12);
  });
});

describe("typed evaluation", () => {
  test("bool, num and str return their own type or fail with CEL_EVAL naming the expression", () => {
    expect(cel.bool("1 < 2", {})).toBe(true);
    expect(cel.num("2.0 * 3.5", {})).toBe(7);
    expect(cel.str("'a' + 'b'", {})).toBe("ab");
    expect(failure(() => cel.num("'abc'", {})).message).toBe("expected number from ('abc'), got string");
    expect(failure(() => cel.str("1 + 1", {})).message).toBe("expected string from (1 + 1)");
  });

  test("literals that are already of the wanted type are not evaluated", () => {
    expect(cel.bool(true, {})).toBe(true);
    expect(cel.num(12, {})).toBe(12);
  });

  test("maps and lists come back as plain data with integers as numbers", () => {
    expect(cel.eval("[1, 2, 3]", {})).toEqual([1, 2, 3]);
    expect(cel.eval("{'a': 1, 'b': 2}", {})).toEqual({ a: 1, b: 2 });
    expect(cel.eval("{'a': [1, 2]}", {})).toEqual({ a: [1, 2] });
    expect(cel.eval("[{'x': 0.5}, {'x': 1.5}]", {})).toEqual([{ x: 0.5 }, { x: 1.5 }]);
  });

  test("arithmetic does not mix integers and doubles, whatever the value, while comparisons do", () => {
    // a whole number in the context is an integer, a fractional one a double
    expect(failure(() => cel.num("tracks.a + 1", { tracks: { a: 35.5 } })).message).toContain("no such overload");
    expect(failure(() => cel.num("tracks.a * 1.5", { tracks: { a: 35 } })).message).toContain("no such overload");
    expect(cel.num("tracks.a * 1.5", { tracks: { a: 35.5 } })).toBe(53.25);
    expect(cel.bool("tracks.a >= 35 && tracks.a < 35.75 && tracks.a != 36.0", { tracks: { a: 35.5 } })).toBe(true);
    expect(cel.bool("tracks.a == 35.0 && tracks.a == 35", { tracks: { a: 35 } })).toBe(true);
    // a conversion makes the kinds agree for either value
    for (const a of [35, 35.5]) {
      expect(cel.num("double(tracks.a) + 1.0", { tracks: { a } })).toBe(a + 1);
      expect(cel.num("int(tracks.a) + 1", { tracks: { a } })).toBe(Math.trunc(a) + 1);
    }
  });

  test("an integer that does not fit a JS number is an error, not a rounded value", () => {
    expect(failure(() => cel.eval("9007199254740993", {})).message).toContain("exceeds safe JS number range");
    expect(cel.eval("9007199254740991", {})).toBe(9007199254740991);
  });
});

describe("errors", () => {
  test("a runtime failure other than a missing key carries the expression and no author hint", () => {
    const err = failure(() => cel.num("1 / 0", {}));
    expect(err.message).toContain("(expression: 1 / 0)");
    expect(err.message).not.toContain("hint");
  });

  test("a missing key gets the hint about guarding it", () => {
    expect(failure(() => cel.bool("world.vars.nope == 1", { world: { vars: {} } })).message).toContain("hint: guard optional keys");
  });

  test("check reports a syntax error, an unknown function and a type mismatch, and passes a sound expression", () => {
    expect(celCheck("1 + 1")).toBeUndefined();
    expect(celCheck("tracks.affinity > 3")).toBeUndefined();
    expect(celCheck("1 +")).toEqual(expect.any(String));
    expect(celCheck("noSuchFunction(1)")).toEqual(expect.any(String));
    expect(celCheck("1 + 'a'")).toEqual(expect.any(String));
  });
});

describe("context and result adapters", () => {
  test("a context keeps strings, booleans and null, turns undefined into null and whole numbers into integers", () => {
    const adapted = adaptCelContext({ a: 2, b: 0.5, c: "x", d: true, e: null, f: undefined, g: [1, { h: 3 }] } as never) as Record<string, unknown>;
    expect(adapted.a).toBe(2n);
    expect(adapted.b).toBe(0.5);
    expect([adapted.c, adapted.d, adapted.e, adapted.f]).toEqual(["x", true, null, null]);
    expect(adapted.g).toEqual([1n, { h: 3n }]);
  });

  test("a result keeps bytes and nested data as they are", () => {
    const bytes = new Uint8Array([1, 2]);
    expect(adaptCelResult(bytes)).toBe(bytes);
    expect(adaptCelResult({ a: [1n, { b: 2n }], c: null })).toEqual({ a: [1, { b: 2 }], c: null });
  });
});
