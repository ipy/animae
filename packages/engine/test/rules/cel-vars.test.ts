import { test, expect } from "bun:test";
import { createCelEngine } from "../../src/rules/cel.ts";
import { AnimaeError } from "../../src/types.ts";

const cel = createCelEngine();
const emptyWorld = { world: { vars: {} as Record<string, unknown> } };

test("missing world.vars key throws CEL_EVAL with author hint", () => {
  try {
    cel.bool("world.vars['missing'] == true", emptyWorld);
    expect.unreachable();
  } catch (e) {
    expect(e).toBeInstanceOf(AnimaeError);
    const err = e as AnimaeError;
    expect(err.code).toBe("CEL_EVAL");
    expect(err.message).toBe(
      "No such key: missing (expression: world.vars['missing'] == true) — hint: guard optional keys with `'key' in world.vars` or declare an initial value under `vars:` in world.yaml",
    );
  }
});

test("'missing' in world.vars is false when unset", () => {
  expect(cel.bool("'missing' in world.vars", emptyWorld)).toBe(false);
});

test("guarded access is false when key missing, true when set", () => {
  const expr = "'k' in world.vars && world.vars['k'] == true";
  expect(cel.bool(expr, emptyWorld)).toBe(false);
  expect(cel.bool(expr, { world: { vars: { k: true } } })).toBe(true);
});

test("present world.vars key reads normally", () => {
  expect(cel.bool("world.vars['mod.feature.enabled'] == true", { world: { vars: { "mod.feature.enabled": true } } })).toBe(
    true,
  );
});

test("guarded numeric compare skips missing keys", () => {
  const expr = "'res.food' in world.vars && world.vars['res.food'] < 35";
  expect(cel.bool(expr, emptyWorld)).toBe(false);
  expect(cel.bool(expr, { world: { vars: { "res.food": 30 } } })).toBe(true);
  expect(cel.bool(expr, { world: { vars: { "res.food": 40 } } })).toBe(false);
});
