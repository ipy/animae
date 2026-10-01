import { test, expect, describe } from "bun:test";
import { z } from "zod";
import { buildAppraiseSchema, buildRenderSchema } from "../../src/pipeline/schemas.ts";
import { coerceAppraiseRaw, coerceRenderRaw, parseJsonLoose } from "../../src/pipeline/coerce.ts";
import { appraiseStage } from "../../src/pipeline/appraise.ts";
import { renderStage } from "../../src/pipeline/render.ts";
import { createPipelineKernel } from "./test-kernel.ts";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";

async function collectRender(
  gen: AsyncGenerator<import("../../src/pipeline/types.ts").RenderPart, import("../../src/pipeline/types.ts").RenderResult>,
) {
  const parts: import("../../src/pipeline/types.ts").RenderPart[] = [];
  let result: import("../../src/pipeline/types.ts").RenderResult | undefined;
  while (true) {
    const n = await gen.next();
    if (n.done) {
      result = n.value;
      break;
    }
    parts.push(n.value);
  }
  return { parts, result: result! };
}

describe("coerce helpers", () => {
  test("parseJsonLoose strips markdown fences", () => {
    const v = parseJsonLoose('```json\n{"type":"chat","intensity":0.5}\n```');
    expect(v).toEqual({ type: "chat", intensity: 0.5 });
  });

  test("coerceAppraiseRaw scales 0-100 intensity and normalizes enums", () => {
    const policy = applyPolicyDefaults({
      events: { types: { flirt: { positive: true }, other: { positive: false } } },
      safety: { enabled: true, response: "in_character", log: false },
      x: { approaches: ["persuasion"] },
    });
    const out = coerceAppraiseRaw(
      { type: "FLIRT", intensity: 70, sincerity: 80, input_class: "META_PROBE", approach: "Persuasion", extra: 1 },
      policy,
    );
    expect(out.type).toBe("flirt");
    expect(out.intensity).toBe(0.7);
    expect(out.sincerity).toBe(0.8);
    expect(out.input_class).toBe("meta_probe");
    expect(out.approach).toBe("persuasion");
  });
});

describe("schema preprocess", () => {
  test("buildAppraiseSchema fills missing optional fields", () => {
    const policy = applyPolicyDefaults({ events: { types: { chat: { positive: true }, other: { positive: false } } } });
    const schema = buildAppraiseSchema(policy);
    const parsed = schema.parse({ type: "chat", intensity: 0.4, sincerity: 0.5, input_class: "normal" });
    expect(parsed.claims).toEqual([]);
    expect(parsed.search_terms).toEqual([]);
    expect(parsed.tags).toEqual([]);
  });

  test("buildAppraiseSchema accepts sloppy model rows", () => {
    const policy = applyPolicyDefaults({ events: { types: { chat: { positive: true }, other: { positive: false } } } });
    const schema = buildAppraiseSchema(policy);
    const parsed = schema.parse({ type: "CHAT", intensity: 55, sincerity: 1, input_class: "normal" });
    expect(parsed.intensity).toBe(0.55);
    expect(parsed.type).toBe("chat");
  });

  test("buildAppraiseSchema drops invalid approach when policy lists approaches", () => {
    const policy = applyPolicyDefaults({
      events: { types: { chat: { positive: true }, other: { positive: false } } },
      x: { approaches: ["persuasion", "comfort"] },
    });
    const schema = buildAppraiseSchema(policy);
    const parsed = schema.parse({
      type: "chat",
      intensity: 0.4,
      sincerity: 0.5,
      input_class: "normal",
      approach: "not_a_real_approach",
    });
    expect(parsed.approach).toBeUndefined();
  });

  test("buildAppraiseSchema drops unknown fields after preprocess", () => {
    const policy = applyPolicyDefaults({ events: { types: { chat: { positive: true }, other: { positive: false } } } });
    const schema = buildAppraiseSchema(policy);
    const parsed = schema.parse({
      type: "chat",
      intensity: 0.4,
      sincerity: 0.5,
      input_class: "normal",
      bonus: "ignore",
    });
    expect(parsed.type).toBe("chat");
    expect(Object.prototype.hasOwnProperty.call(parsed, "bonus")).toBe(false);
  });

  test("buildRenderSchema parses markdown-fenced JSON bodies", () => {
    const policy = applyPolicyDefaults({
      events: { types: { chat: { positive: true } } },
      choices: { enabled: false, count: 3, filter: "true" },
    });
    const schema = buildRenderSchema(policy);
    const raw = parseJsonLoose('```json\n{"text":"第一行\\n第二行","cues":[],"intent_realized":"respond"}\n```');
    const parsed = schema.parse(raw);
    expect(parsed.text).toBe("第一行\n第二行");
  });

  test("buildRenderSchema keeps newlines in text and drops bad cue at post-validate", () => {
    const policy = applyPolicyDefaults({
      events: { types: { chat: { positive: true } } },
      cues: { types: { emote: { args: { who: { type: "string" } } } } },
    });
    const schema = buildRenderSchema(policy);
    const parsed = schema.parse({
      text: "第一行\n第二行",
      intent_realized: "respond",
      cues: [{ type: "emote", args: { who: "a" }, at: 999 }],
    });
    expect(parsed.text).toContain("\n");
    expect(parsed.cues[0]?.at).toBe(999);
  });
});

describe("pipeline stages with sloppy scripted output", () => {
  test("appraiseStage normalizes intensity 0-100", async () => {
    const { k } = createPipelineKernel({
      policy: { events: { types: { flirt: { positive: true }, other: { positive: false } } } },
      s1Handler: () => ({
        type: "flirt",
        intensity: 85,
        sincerity: 90,
        claims: [],
        search_terms: ["smile"],
        tags: ["Romance"],
        input_class: "normal",
      }),
    });
    const turn = { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "x", autonomous: false };
    const { appraisal } = await appraiseStage(k, turn, {
      speaker: "npc1",
      addressee: "npc1",
      actor: "player",
      actorText: "hi",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
      history: [],
      fieldEffects: {},
    });
    expect(appraisal.intensity).toBeCloseTo(0.85);
    expect(appraisal.tags).toEqual(["romance"]);
  });

  test("renderStage drops cue beyond text length without crashing", async () => {
    const { k } = createPipelineKernel({
      policy: {
        events: { types: { chat: { positive: true } } },
        cues: { types: { emote: { args: { who: { type: "string" } } } } },
        choices: { enabled: false, count: 3, filter: "true" },
        render: { retryOnMismatch: 0, recentTurns: 4 },
      },
      s1Handler: async function* () {
        yield {
          text: "短",
          cues: [{ type: "emote", args: { who: "npc1" }, at: 50 }],
          intent_realized: "respond",
        };
      },
    });
    const turn = { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "x", autonomous: false };
    const { result } = await collectRender(
      renderStage(k, turn, {
        tier: "s1",
        speaker: "npc1",
        addressee: "player",
        intent: { intent: "respond", scores: { respond: 1 } },
        appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
        fieldEffects: {},
        scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
        history: [],
        sidenotes: [],
        hits: [],
      }),
    );
    expect(result.text).toBe("短");
    expect(result.cues).toEqual([]);
  });

  test("renderStage fails with MODEL_EMPTY instead of returning a blank reply", async () => {
    const { k } = createPipelineKernel({
      policy: {
        events: { types: { chat: { positive: true } } },
        choices: { enabled: false, count: 3, filter: "true" },
        render: { retryOnMismatch: 0, recentTurns: 4 },
      },
      // Not what a validating adapter would return; a host model that skips validation must not slip through either.
      s1Handler: () => ({ text: "", cues: [], intent_realized: "respond" }),
    });
    k.models.s1 = {
      ...k.models.s1,
      async *stream() {
        yield { type: "final" as const, value: { text: "  ", cues: [], intent_realized: "respond" } };
      },
    };
    const turn = { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "x", autonomous: false };
    const run = collectRender(
      renderStage(k, turn, {
        tier: "s1",
        speaker: "npc1",
        addressee: "player",
        intent: { intent: "respond", scores: { respond: 1 } },
        appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
        fieldEffects: {},
        scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
        history: [],
        sidenotes: [],
        hits: [],
      }),
    );
    await expect(run).rejects.toMatchObject({ code: "MODEL_EMPTY" });
  });
});

describe("coerceRenderRaw", () => {
  test("normalizes choice event types", () => {
    const out = coerceRenderRaw({
      text: "ok",
      intent_realized: "Respond",
      cues: [],
      choices: [{ text: "a", expected_event_type: "Matchmake", tags: ["Romance"] }],
    });
    expect(out.intent_realized).toBe("Respond");
    expect((out.choices as { expected_event_type: string }[])[0]?.expected_event_type).toBe("matchmake");
  });

  test("reads the spoken reply from the keys models use instead of `text`", () => {
    for (const key of ["dialogue", "speech", "reply", "response", "content", "message", "line", "narration"]) {
      expect(coerceRenderRaw({ [key]: "Morning!" }).text).toBe("Morning!");
    }
    // `text` wins, a blank `text` does not shadow a usable alias, and non-strings never become "[object Object]".
    expect(coerceRenderRaw({ text: "A", reply: "B" }).text).toBe("A");
    expect(coerceRenderRaw({ text: "  ", reply: "B" }).text).toBe("B");
    expect(coerceRenderRaw({ text: { nested: true } }).text).toBe("");
  });
});

describe("a reply without text", () => {
  const schema = buildRenderSchema(applyPolicyDefaults({ events: { types: { chat: { positive: true } } } }));

  test("is rejected by the render schema, so the adapter repairs instead of committing a blank line", () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ cues: [], intent_realized: "respond" }).success).toBe(false);
    expect(schema.safeParse({ text: "  \n", intent_realized: "respond" }).success).toBe(false);
    expect(schema.safeParse({ text: "Hi.", intent_realized: "respond" }).success).toBe(true);
  });

  test("an aliased reply key still parses into `text`", () => {
    const parsed = schema.parse({ response: "Hi.", intent_realized: "respond" });
    expect(parsed.text).toBe("Hi.");
  });
});
