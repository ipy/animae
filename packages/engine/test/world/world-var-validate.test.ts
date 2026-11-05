import { expect, test } from "bun:test";
import { validateWorldVar } from "../../src/world/world-var-validate.ts";
import { AnimaeError } from "../../src/types.ts";

const schema = {
  mood: { type: "number" as const, min: 0, max: 1 },
  tag: { type: "string" as const, enum: ["a", "b"] },
  flags: { type: "array" as const, max: 2, items: { type: "string" as const } },
  meta: {
    type: "object" as const,
    fields: {
      ok: { type: "boolean" as const },
      note: { type: "string" as const, optional: true },
    },
  },
};

test("validateWorldVar accepts in-range values and rejects invalid shapes", () => {
  expect(() => validateWorldVar("mood", 0.5, schema)).not.toThrow();
  expect(() => validateWorldVar("tag", "a", schema)).not.toThrow();
  expect(() => validateWorldVar("flags", ["x"], schema)).not.toThrow();
  expect(() => validateWorldVar("meta", { ok: true }, schema)).not.toThrow();
  expect(() => validateWorldVar("unknown", 1, schema)).not.toThrow();
  expect(() => validateWorldVar("mood", "x", schema)).toThrow(AnimaeError);
  expect(() => validateWorldVar("mood", 2, schema)).toThrow(/above max/);
  expect(() => validateWorldVar("tag", "z", schema)).toThrow(/enum/);
  expect(() => validateWorldVar("flags", ["a", "b", "c"], schema)).toThrow(/too long/);
  expect(() => validateWorldVar("meta", {}, schema)).toThrow(/required/);
});
