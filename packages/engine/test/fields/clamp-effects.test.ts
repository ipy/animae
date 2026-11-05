import { expect, test } from "bun:test";
import { clampEffects } from "../../src/fields/index.ts";
import type { FieldEffects } from "../../src/schema/authored.ts";

const effects: FieldEffects = {
  event_prob: { betrayal: 0.9, help: -0.8, quiet: 0.1 },
  salience: [
    { tags: ["secret"], boost: 4 },
    { tags: ["rumor"], boost: -5 },
  ],
  track_offset: { trust: 30, fear: -45 },
  track_mult: { trust: { praise: 3, "*": 1.2 }, fear: { threat: -4 } },
  intent_bias: { comfort: 6, flee: -7, talk: 1 },
};

test("clampEffects limits each capped path to its magnitude, keeps the sign and reports what it changed", () => {
  const caps = {
    event_prob: 0.3,
    "salience.boost": 2,
    track_offset: 10,
    track_mult: 1.5,
    intent_bias: 3,
  };
  const { effects: out, clamped } = clampEffects(effects, caps, false);

  expect(out.event_prob).toEqual({ betrayal: 0.3, help: -0.3, quiet: 0.1 });
  expect(out.salience).toEqual([
    { tags: ["secret"], boost: 2 },
    { tags: ["rumor"], boost: -2 },
  ]);
  expect(out.track_offset).toEqual({ trust: 10, fear: -10 });
  expect(out.track_mult).toEqual({ trust: { praise: 1.5, "*": 1.2 }, fear: { threat: -1.5 } });
  expect(out.intent_bias).toEqual({ comfort: 3, flee: -3, talk: 1 });
  expect(new Set(clamped)).toEqual(
    new Set(["event_prob", "salience.boost", "track_offset", "track_mult", "intent_bias"]),
  );

  // The input is not modified.
  expect(effects.track_mult).toEqual({ trust: { praise: 3, "*": 1.2 }, fear: { threat: -4 } });
  expect(effects.intent_bias).toEqual({ comfort: 6, flee: -7, talk: 1 });
});

test("clampEffects leaves values within their cap and uncapped paths alone", () => {
  const { effects: out, clamped } = clampEffects(effects, { track_mult: 5 }, false);
  expect(out.track_mult).toEqual({ trust: { praise: 3, "*": 1.2 }, fear: { threat: -4 } });
  expect(out.intent_bias).toEqual(effects.intent_bias);
  expect(out.track_offset).toEqual(effects.track_offset);
  expect(clamped).toEqual([]);
});

test("clampEffects does nothing when the caller bypasses the caps or none are configured", () => {
  const caps = { intent_bias: 1, track_mult: 1 };
  expect(clampEffects(effects, caps, true)).toEqual({ effects, clamped: [] });
  expect(clampEffects(effects, undefined, false)).toEqual({ effects, clamped: [] });
  expect(clampEffects(effects, {}, false)).toEqual({ effects, clamped: [] });
});
