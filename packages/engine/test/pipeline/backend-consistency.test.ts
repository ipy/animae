import { describe, expect, test } from "bun:test";
import { appraiseStage } from "../../src/pipeline/appraise.ts";
import { renderStage } from "../../src/pipeline/render.ts";
import { buildAppraiseSchema, buildRenderSchema } from "../../src/pipeline/schemas.ts";
import type { RenderPart, RenderResult } from "../../src/pipeline/types.ts";
import { createPipelineKernel, S2_BINDING } from "./test-kernel.ts";

/**
 * The two backends share one set of interfaces: the same request schema validates what a model answers and what the
 * rule backend answers, so everything downstream of the stage sees the same shapes. These tests run each stage once
 * on a scripted model and once on rules, with the same policy, and compare what comes out.
 */

const POLICY = {
  events: { types: { chat: { positive: true }, care: { positive: true } } },
  intent: { types: ["respond"] },
  cues: { types: { emote: { args: { who: { type: "string" } } } } },
  appraise: {
    patterns: [{ match: "thank", event: { type: "care", intensity: 0.7, sincerity: 0.8, tags: [] } }],
    fallback: { type: "chat", intensity: 0.4, sincerity: 0.6, tags: [] },
  },
  choices: {
    enabled: true,
    count: 2,
    filter: "true",
    rules: [
      { text: "Thank her.", when: "true", event_type: "care", tags: [], intensity: 0.7 },
      { text: "Ask why.", when: "true", event_type: "chat", tags: [] },
    ],
  },
  render: {
    retryOnMismatch: 0,
    recentTurns: 4,
    layers: [
      { id: "line", when: "true", pool: [{ text: "Hello", weight: 1, cues: [{ type: "emote", args: { who: "npc1" }, at: 0 }], intent: "respond" }] },
      { id: "rain", when: "true", pool: [{ text: "Rain taps.", weight: 1, cues: [], style: "narration" }] },
      { id: "later", when: "true", pool: [{ text: "Later.", weight: 1, cues: [], style: "narration_break" }] },
    ],
  },
};

const TURN = { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "x", autonomous: false };
const SCENE = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };

/** What a well-behaved model answers for the same render: the rule backend's lines, as a model would write them. */
const LLM_RENDER = {
  narrations: [
    { text: "Rain taps.", style: "normal" },
    { text: "Later.", style: "scene_break" },
  ],
  text: "Hello",
  cues: [{ type: "emote", args: { who: "npc1" }, at: 0 }],
  intent_realized: "respond",
  choices: [
    { text: "Thank her.", expected_event_type: "care", tags: [], intensity: 0.7 },
    { text: "Ask why.", expected_event_type: "chat", tags: [] },
  ],
};

async function drain(gen: AsyncGenerator<RenderPart, RenderResult>): Promise<{ parts: RenderPart[]; result: RenderResult }> {
  const parts: RenderPart[] = [];
  for (;;) {
    const n = await gen.next();
    if (n.done) return { parts, result: n.value };
    parts.push(n.value);
  }
}

function renderOn(binding: Parameters<typeof renderStage>[2]["binding"]) {
  const { k } = createPipelineKernel({ policy: POLICY as never, s2Handler: () => LLM_RENDER });
  return drain(
    renderStage(k, TURN, {
      binding,
      speaker: "npc1",
      addressee: "player",
      intent: { intent: "respond", scores: { respond: 1 } },
      appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
      fieldEffects: {},
      scene: SCENE,
      history: [],
      sidenotes: [],
      hits: [],
      inputEventId: "evt_0001",
      input: { text: "x" },
    }),
  );
}

const keys = (o: object) => Object.keys(o).sort();

describe("render: a model and the rule backend answer through the same schema", () => {
  test("the same lines produce the same parts, in the same order, with the same fields", async () => {
    const llm = await renderOn(S2_BINDING);
    const rule = await renderOn({ backend: "rule" });
    // identical stream of parts: narration paragraphs first (with `newParagraph`), then the utterance, then the cue
    expect(rule.parts).toEqual(llm.parts);
    expect(rule.parts.map((p) => p.type)).toEqual(["narration", "narration", "text", "cue"]);
    expect(rule.parts[0]).toMatchObject({ type: "narration", style: "normal", newParagraph: true });
    expect(rule.parts[1]).toMatchObject({ type: "narration", style: "scene_break", newParagraph: true });

    expect(rule.result.text).toBe(llm.result.text);
    expect(rule.result.narrations).toEqual(llm.result.narrations);
    expect(rule.result.cues).toEqual(llm.result.cues);
    expect(rule.result.intent_realized).toBe(llm.result.intent_realized);
    expect(rule.result.choices).toEqual(llm.result.choices);
    expect(rule.result.mismatch).toBe(false);
    expect(llm.result.mismatch).toBe(false);
  });

  test("every field a model's result has, the rule result has (and no field the model's lacks)", async () => {
    const llm = await renderOn(S2_BINDING);
    const rule = await renderOn({ backend: "rule" });
    // only what the model's call itself measures may differ: token usage and the recording key
    const ruleKeys = keys(rule.result).filter((k) => !["usage", "recording"].includes(k));
    const llmKeys = keys(llm.result).filter((k) => !["usage", "recording"].includes(k));
    expect(ruleKeys).toEqual(llmKeys);
    for (const n of rule.result.narrations) expect(keys(n)).toEqual(["style", "text"]);
    for (const c of rule.result.cues) expect(keys(c)).toEqual(["args", "at", "type"]);
    for (const [i, c] of rule.result.choices.entries()) expect(keys(c)).toEqual(keys(llm.result.choices[i]!));
  });

  test("the rule answer validates against the schema the engine gives a model", async () => {
    const { k } = createPipelineKernel({ policy: POLICY as never });
    const schema = buildRenderSchema(k.policy);
    const { result } = await renderOn({ backend: "rule" });
    // what the pipeline would hand a model's answer to: the same zod object accepts the rule backend's answer
    const parsed = schema.parse({
      narrations: result.narrations,
      text: result.text,
      cues: result.cues,
      intent_realized: result.intent_realized,
      choices: result.choices.map(({ text, expected_event_type, tags, intensity }) => ({
        text,
        expected_event_type,
        tags,
        ...(intensity !== undefined ? { intensity } : {}),
      })),
    }) as { narrations?: { style: string }[] };
    expect(parsed.narrations?.map((n) => n.style)).toEqual(["normal", "scene_break"]);
    // the schema is the contract for both: a reply without text is rejected, whoever wrote it
    expect(() => schema.parse({ text: "   ", cues: [], intent_realized: "r" })).toThrow();
  });

  test("narration style defaults to normal in the schema; styles a model invents are read as normal", () => {
    const { k } = createPipelineKernel({ policy: POLICY as never });
    const schema = buildRenderSchema(k.policy);
    const parse = (narrations: unknown) =>
      (schema.parse({ narrations, text: "Hello", cues: [], intent_realized: "respond" }) as {
        narrations?: { text: string; style: string }[];
      }).narrations;
    // omitted style: normal; a bare string is a normal paragraph
    expect(parse([{ text: "Rain taps." }])).toEqual([{ text: "Rain taps.", style: "normal" }]);
    expect(parse(["Rain taps."])).toEqual([{ text: "Rain taps.", style: "normal" }]);
    // the two styles of the contract, and the spellings models give a scene break
    expect(parse([{ text: "Later.", style: "scene_break" }])).toEqual([{ text: "Later.", style: "scene_break" }]);
    expect(parse([{ text: "Later.", style: "divider" }])).toEqual([{ text: "Later.", style: "scene_break" }]);
    // there is no third style: `aside` and the like are ordinary narration
    expect(parse([{ text: "Psst.", style: "aside" }])).toEqual([{ text: "Psst.", style: "normal" }]);
    // empty paragraphs are not narration
    expect(parse([{ text: "   " }, { text: "Rain taps." }])).toEqual([{ text: "Rain taps.", style: "normal" }]);
    expect(parse([])).toBeUndefined();
  });

  test("a rule line's cue goes through the same cue validation as a model's", async () => {
    const policy = {
      ...POLICY,
      render: {
        ...POLICY.render,
        layers: [{ id: "line", when: "true", pool: [{ text: "Hi", weight: 1, intent: "respond", cues: [{ type: "ghost", args: {} }] }] }],
      },
    };
    const { k } = createPipelineKernel({
      policy: policy as never,
      s2Handler: () => ({ text: "Hi", cues: [{ type: "ghost", args: {} }], intent_realized: "respond" }),
    });
    const base = {
      speaker: "npc1",
      addressee: "player",
      intent: { intent: "respond", scores: { respond: 1 } },
      appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" as const },
      fieldEffects: {},
      scene: SCENE,
      history: [],
      sidenotes: [],
      hits: [],
      inputEventId: "evt_0001",
      input: { text: "x" },
    };
    const llm = await drain(renderStage(k, TURN, { ...base, binding: S2_BINDING }));
    const rule = await drain(renderStage(k, TURN, { ...base, binding: { backend: "rule" } }));
    // `ghost` is not a declared cue type: dropped for the model's answer and for the rule backend's alike
    expect(llm.result.cues).toEqual([]);
    expect(rule.result.cues).toEqual([]);
  });

  test("the rule backend never reports an intent mismatch, and a model's wrong intent is a mismatch", async () => {
    const { k } = createPipelineKernel({ policy: POLICY as never, s2Handler: () => ({ ...LLM_RENDER, intent_realized: "something_else" }) });
    const input = {
      speaker: "npc1",
      addressee: "player",
      intent: { intent: "respond", scores: { respond: 1 } },
      appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" as const },
      fieldEffects: {},
      scene: SCENE,
      history: [],
      sidenotes: [],
      hits: [],
      inputEventId: "evt_0001",
      input: { text: "x" },
    };
    const llm = await drain(renderStage(k, TURN, { ...input, binding: S2_BINDING }));
    const rule = await drain(renderStage(k, TURN, { ...input, binding: { backend: "rule" } }));
    expect(llm.result.mismatch).toBe(true);
    expect(llm.result.mismatchDraft).toMatchObject({ kind: "intent.mismatch", decided: "respond", realized: "something_else" });
    expect(rule.result.mismatch).toBe(false);
    expect(rule.result.mismatchDraft).toBeUndefined();
    expect(rule.result.retried).toBe(false);
  });

  test("a narration line has no effect on intent_realized", async () => {
    // layers with and without narration give the utterance layer's intent either way
    const withNarration = await renderOn({ backend: "rule" });
    const policy = {
      ...POLICY,
      render: { ...POLICY.render, layers: POLICY.render.layers.filter((l) => (l.pool[0] as { style?: string }).style === undefined) },
    };
    const { k } = createPipelineKernel({ policy: policy as never });
    const without = await drain(
      renderStage(k, TURN, {
        binding: { backend: "rule" },
        speaker: "npc1",
        addressee: "player",
        intent: { intent: "respond", scores: { respond: 1 } },
        appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
        fieldEffects: {},
        scene: SCENE,
        history: [],
        sidenotes: [],
        hits: [],
        inputEventId: "evt_0001",
        input: { text: "x" },
      }),
    );
    expect(withNarration.result.narrations).toHaveLength(2);
    expect(without.result.narrations).toHaveLength(0);
    expect(withNarration.result.intent_realized).toBe("respond");
    expect(without.result.intent_realized).toBe("respond");
    expect(withNarration.result.text).toBe(without.result.text);
    expect(withNarration.result.mismatch).toBe(false);
  });
});

describe("appraise: a model and the rule backend answer through the same schema", () => {
  async function appraiseOn(backend: "llm" | "rule", text: string) {
    const { k } = createPipelineKernel({
      policy: POLICY as never,
      s1Handler: () => ({
        type: "care",
        intensity: 0.7,
        sincerity: 0.8,
        claims: [],
        search_terms: ["thank"],
        tags: [],
        input_class: "normal",
      }),
    });
    return appraiseStage(k, TURN, {
      speaker: "npc1",
      addressee: "player",
      actor: "player",
      actorText: text,
      scene: SCENE,
      history: [],
      fieldEffects: {},
      backend,
    });
  }

  test("an appraisal from either backend has the same fields and passes the same zod schema", async () => {
    const llm = await appraiseOn("llm", "thank you");
    const rule = await appraiseOn("rule", "thank you");
    expect(keys(rule.appraisal)).toEqual(keys(llm.appraisal));
    expect(rule.appraisal).toMatchObject({ type: "care", intensity: 0.7, sincerity: 0.8, input_class: "normal" });
    expect(llm.appraisal).toMatchObject({ type: "care", intensity: 0.7, sincerity: 0.8, input_class: "normal" });
    expect(llm.binding.backend).toBe("llm");
    expect(rule.binding).toEqual({ backend: "rule" });
    const { k } = createPipelineKernel({ policy: POLICY as never });
    const schema = buildAppraiseSchema(k.policy);
    for (const a of [llm.appraisal, rule.appraisal]) {
      const { approach, ...rest } = a;
      void approach;
      expect(() => schema.parse(rest)).not.toThrow();
    }
  });

  test("both backends emit the same kinds of drafts for the same line", async () => {
    const llm = await appraiseOn("llm", "thank you");
    const rule = await appraiseOn("rule", "thank you");
    expect(rule.drafts.map((d) => d.kind)).toEqual(llm.drafts.map((d) => d.kind));
  });
});
