import { test, expect, describe } from "bun:test";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import { createPipelineKernel, charDef } from "./test-kernel.ts";
describe("buildPromptSegments", () => {
  test("deterministic segments and placement", () => {
    const { k, setState } = createPipelineKernel({
      chars: [
        {
          ...charDef("npc1"),
          secrets: [{ id: "s1", text: "hidden truth", tags: ["secret"], unlock: "false" }],
        },
        charDef("player"),
      ],
    });
    setState({
      ...k.timeline.state(),
      characters: {
        ...k.timeline.state().characters,
        npc1: { ...k.timeline.state().characters.npc1!, unlockedSecrets: [] },
      },
    });

    const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };
    const input = {
      purpose: "render" as const,
      speaker: "npc1",
      addressee: "player",
      scene,
      history: [],
      fieldEffects: { topic_access: { close: ["forbidden"], open: [] } },
      tier: "standard" as const,
      intent: { intent: "respond", scores: { respond: 1 } },
    };

    const a = buildPromptSegments(k, input);
    const b = buildPromptSegments(k, input);
    expect(a).toEqual(b);
    expect(a.static).toMatch(/BCP-47|\(en\)/);
    expect(a.static).not.toContain("hidden truth");
    expect(a.semiStatic).not.toContain("scn_0001");
    expect(a.dynamic).toContain("Topics closed: forbidden");
    expect(a.user).toContain("Generate npc1's in-character response");
    expect(a.static).toContain("Output contract");
  });

  test("render user message is a single task line without duplicate language directives", () => {
    const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };
    const input = {
      purpose: "render" as const,
      speaker: "npc1",
      addressee: "player",
      scene,
      history: [],
      fieldEffects: {},
      tier: "standard" as const,
      intent: { intent: "respond", scores: { respond: 1 } },
    };
    // Working prompt in one language, player-visible output in another: the last thing the model reads must be the
    // directive in the output language, otherwise persona/examples in the working language win.
    const cross = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      i18n: { promptLocale: "fr", outputLocale: "en" },
    }).k;
    const user = buildPromptSegments(cross, input).user;
    expect(user).not.toContain("Internal structured fields");
    expect(user.split("\n\n").length).toBeLessThanOrEqual(2);
    expect(buildPromptSegments(cross, input).static).toContain("en");
  });

  test("unlocked secrets appear in static only", () => {
    const { k, setState } = createPipelineKernel({
      chars: [
        {
          ...charDef("npc1"),
          secrets: [{ id: "s1", text: "I know the code", tags: ["x"], unlock: "true" }],
        },
      ],
    });
    setState({
      ...k.timeline.state(),
      characters: {
        ...k.timeline.state().characters,
        npc1: { ...k.timeline.state().characters.npc1!, unlockedSecrets: ["s1"] },
      },
    });
    const seg = buildPromptSegments(k, {
      purpose: "appraise",
      speaker: "npc1",
      addressee: "player",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
      history: [],
      fieldEffects: {},
      actorText: "hello",
    });
    expect(seg.static).toContain("I know the code");
  });

  test("knowledge docs reach the prompt: always in static, when in dynamic, on-demand stays out of both", () => {
    const doc = (id: string, inject: "always" | "when" | "on-demand", body: string, when?: string) => ({
      id,
      name: `Doc ${id}`,
      description: `about ${id}`,
      scope: "world",
      inject,
      when,
      body,
      priority: 1,
      tags: [],
      path: `world/knowledge/${id}.md`,
      shareable: false,
    });
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      knowledge: [
        doc("always-doc", "always", "ALWAYS_BODY"),
        doc("when-true", "when", "WHEN_TRUE_BODY", "event.type == 'confession'"),
        doc("when-false", "when", "WHEN_FALSE_BODY", "event.type == 'betrayal'"),
        doc("lazy", "on-demand", "ON_DEMAND_BODY"),
      ] as never,
    });
    const seg = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
      history: [],
      fieldEffects: {},
      tier: "standard",
      appraisal: { type: "confession", intensity: 0.5, sincerity: 1, approach: "", tags: [], claims: [], input_class: "normal", positive: true, text: "" },
      intent: { intent: "respond", scores: { respond: 1 } },
    } as never);
    expect(seg.static).toContain("ALWAYS_BODY");
    expect(seg.dynamic).toContain("WHEN_TRUE_BODY");
    expect(seg.dynamic).not.toContain("WHEN_FALSE_BODY");
    for (const text of [seg.static, seg.semiStatic, seg.dynamic]) expect(text).not.toContain("ON_DEMAND_BODY");
    // An `always` doc is attached once, never repeated as contextual knowledge.
    expect(seg.dynamic).not.toContain("ALWAYS_BODY");
  });
  describe("what the appraisal prompt carries", () => {
    const appraiseInput = (extra: Record<string, unknown> = {}) =>
      ({
        purpose: "appraise" as const,
        speaker: "npc1",
        addressee: "player",
        scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
        history: [],
        fieldEffects: {},
        actorText: "hello",
        ...extra,
      }) as never;
    const kernelWith = (policyPrompt?: Record<string, unknown>) =>
      createPipelineKernel({
        chars: [charDef("npc1"), charDef("player")],
        policy: policyPrompt ? ({ x: { prompt: policyPrompt } } as never) : undefined,
        knowledge: [
          {
            id: "world/knowledge/ctx.md",
            name: "Ctx",
            description: "d",
            scope: "world",
            inject: "when",
            when: "true",
            body: "CONTEXT_BODY",
            priority: 1,
            tags: [],
            path: "world/knowledge/ctx.md",
            shareable: false,
          },
        ] as never,
      }).k;

    test("constant instructions go to the static segment, the dynamic segment keeps only per-turn parts", () => {
      const k = kernelWith();
      const seg = buildPromptSegments(k, appraiseInput({ extraStatic: "TASK_AND_TYPES", extraDynamic: "PER_TURN_HINT" }));
      expect(seg.static).toContain("TASK_AND_TYPES");
      expect(seg.dynamic).not.toContain("TASK_AND_TYPES");
      expect(seg.dynamic).toContain("PER_TURN_HINT");
    });

    test("contextual knowledge steers narration, so only render prompts receive it", () => {
      const k = kernelWith();
      const render = buildPromptSegments(k, {
        purpose: "render",
        speaker: "npc1",
        addressee: "player",
        scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
        history: [],
        fieldEffects: {},
        tier: "standard",
        intent: { intent: "respond", scores: { respond: 1 } },
      } as never);
      expect(render.dynamic).toContain("CONTEXT_BODY");
      expect(buildPromptSegments(k, appraiseInput()).dynamic).not.toContain("CONTEXT_BODY");
    });

    test("narration guidance of template partials is for render prompts only", () => {
      const { k } = createPipelineKernel({
        chars: [charDef("npc1"), charDef("player")],
        policy: { x: { prompt: { template_partials: ["narrator-style"] } } } as never,
      });
      (k.authored.templates.character as Record<string, unknown>)["narrator-style"] = {
        id: "narrator-style",
        kind: "character",
        guidance: "PARTIAL_GUIDANCE",
        fields: {},
        defaults: {},
        promote: [],
      };
      const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };
      const render = buildPromptSegments(k, {
        purpose: "render",
        speaker: "npc1",
        addressee: "player",
        scene,
        history: [],
        fieldEffects: {},
        tier: "standard",
        intent: { intent: "respond", scores: { respond: 1 } },
      } as never);
      expect(render.static).toContain("PARTIAL_GUIDANCE");
      expect(buildPromptSegments(k, appraiseInput()).static).not.toContain("PARTIAL_GUIDANCE");
    });

    test("the scene section names the place; its atmosphere text is for render prompts only", () => {
      const { k } = createPipelineKernel({ chars: [charDef("npc1"), charDef("player")] });
      (k.authored.locations.loc as { description?: string }).description = "ATMOSPHERE_TEXT";
      const appraise = buildPromptSegments(k, appraiseInput());
      expect(appraise.semiStatic).toContain("Loc");
      expect(appraise.semiStatic).not.toContain("ATMOSPHERE_TEXT");
      const render = buildPromptSegments(k, {
        purpose: "render",
        speaker: "npc1",
        addressee: "player",
        scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
        history: [],
        fieldEffects: {},
        tier: "standard",
        intent: { intent: "respond", scores: { respond: 1 } },
      } as never);
      expect(render.semiStatic).toContain("ATMOSPHERE_TEXT");
    });
  });
});
