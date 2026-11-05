import { describe, expect, test } from "bun:test";
import { checkRuleModeReadiness, validatePolicyDocument } from "../../src/index.ts";

const base = {
  events: { types: { praise: {}, insult: {} } },
  intent: { types: ["respond", "deflect"] },
  cues: { types: { smile: { args: {} } } },
};

function validate(extra: Record<string, unknown>) {
  return validatePolicyDocument({ ...base, ...extra });
}

const messages = (r: ReturnType<typeof validate>) => r.issues.map((i) => `${i.path}: ${i.message}`);

describe("rule backend validation", () => {
  test("a well-formed rule backend passes", () => {
    const r = validate({
      appraise: {
        patterns: [{ match: "thank", event: { type: "praise" } }],
        fallback: { type: "other" },
        commands: { care: "praise" },
        inputClass: { injection: ["ignore previous"], metaProbe: ["system prompt"] },
      },
      render: {
        layers: [
          { id: "warm", when: "event.positive", pool: [{ text: "Glad to hear it, {{ other }}.", intent: "respond", cues: [{ type: "smile" }] }] },
          { id: "dusk", when: "scene.first", pool: [{ text: "Dusk settles.", style: "narration" }] },
        ],
        fallback: { text: "…", intent: "deflect" },
      },
      choices: { enabled: true, rules: [{ text: "Thank her", event_type: "praise" }] },
      memory: { writing: { template: "{{ text }}", importanceByEventType: { praise: 0.6 } } },
      reflection: { summaryTemplate: "Day {{ time.day }} passed." },
      offscreen: { fidelity: { default: "rule" }, narrateTemplate: "{{ location.name }} stays quiet." },
    });
    expect(messages(r)).toEqual([]);
    expect(r.policy).toBeDefined();
  });

  test("a regular expression that does not compile is an error", () => {
    const r = validate({ appraise: { patterns: [{ match: "(unclosed", event: { type: "praise" } }] } });
    expect(messages(r)).toEqual([expect.stringContaining("appraise.patterns[0].match: invalid regular expression")]);
  });

  test("event types, commands and the fallback must exist", () => {
    const r = validate({
      appraise: {
        patterns: [{ match: "x", event: { type: "bribe" } }],
        fallback: { type: "shrug" },
        commands: { care: "hug" },
      },
    });
    expect(messages(r)).toEqual([
      'appraise.patterns[0].event.type: unknown event type "bribe"',
      'appraise.fallback.type: unknown event type "shrug"',
      'appraise.commands.care: unknown event type "hug"',
    ]);
  });

  test("a template placeholder that does not compile is an error", () => {
    const r = validate({ render: { layers: [{ id: "a", pool: [{ text: "Hello {{ other. }}" }] }] } });
    expect(messages(r)).toEqual([expect.stringContaining('render.layers[0].pool[0].text: template expression "other."')]);
  });

  test("layer ids are unique", () => {
    const r = validate({
      render: { layers: [{ id: "a", pool: [{ text: "one" }] }, { id: "a", pool: [{ text: "two" }] }] },
    });
    expect(messages(r)).toEqual(['render.layers[1].id: duplicate layer id "a"']);
  });

  test("a pool is all narration or all utterance", () => {
    const r = validate({
      render: { layers: [{ id: "a", pool: [{ text: "She nods." }, { text: "Rain.", style: "narration" }] }] },
    });
    expect(messages(r)).toEqual([expect.stringContaining("render.layers[0].pool: a layer is either an utterance layer or a narration layer")]);
  });

  test("a narration entry has no speaker, so no cues or intent", () => {
    const r = validate({
      render: {
        layers: [
          { id: "a", pool: [{ text: "Rain.", style: "narration", intent: "respond" }] },
          { id: "b", pool: [{ text: "Wind.", style: "narration_break", cues: [{ type: "smile" }] }] },
        ],
      },
    });
    expect(messages(r)).toEqual([
      "render.layers[0].pool[0]: a narration entry has no speaker: it cannot carry cues or an intent",
      "render.layers[1].pool[0]: a narration entry has no speaker: it cannot carry cues or an intent",
    ]);
  });

  test("intents must be declared; unknown cue types only warn", () => {
    const r = validate({
      render: { layers: [{ id: "a", pool: [{ text: "Hi.", intent: "flirt", cues: [{ type: "wink" }] }] }], fallback: { text: "…", intent: "scheme" } },
    });
    expect(messages(r)).toEqual([
      'render.layers[0].pool[0].intent: unknown intent "flirt"',
      'render.fallback.intent: unknown intent "scheme"',
    ]);
    const warned = validatePolicyDocument({ ...base, render: { layers: [{ id: "a", pool: [{ text: "Hi.", cues: [{ type: "wink" }] }] }] } });
    expect(warned.policy).toBeDefined();
    expect(warned.warnings.map((w) => w.message)).toEqual(['unknown cue type "wink"']);
  });

  test("autonomous exchanges are spoken, never narration", () => {
    const r = validate({
      scene: { autonomous: { maxExchangesPerPlayerTurn: 1, rules: [{ id: "a", pool: [{ text: "Wind.", style: "narration" }] }] } },
    });
    expect(messages(r)).toEqual(["scene.autonomous.rules[0].pool: autonomous exchanges are spoken: a pool entry cannot be narration"]);
  });

  test("choice rules and memory tables name existing event types", () => {
    const r = validate({
      choices: { enabled: true, rules: [{ text: "Hug", event_type: "hug" }] },
      memory: { writing: { importanceByEventType: { bribe: 0.5 }, valenceByEventType: { cheer: 0.5 } } },
    });
    expect(messages(r)).toEqual([
      'choices.rules[0].event_type: unknown event type "hug"',
      'memory.writing.importanceByEventType.bribe: unknown event type "bribe"',
      'memory.writing.valenceByEventType.cheer: unknown event type "cheer"',
    ]);
  });

  test("reflection and offscreen templates are checked like any other", () => {
    const r = validate({
      reflection: { summaryTemplate: "{{ time.day + }}" },
      offscreen: { fidelity: { default: "rule" }, narrateTemplate: "{{ ( }}" },
    });
    expect(messages(r).map((m) => m.split(":")[0])).toEqual(["reflection.summaryTemplate", "offscreen.narrateTemplate"]);
  });
});

describe("rule mode readiness", () => {
  const ready = {
    ...base,
    render: {
      layers: [{ id: "any", when: "true", pool: [{ text: "Hm." }] }],
    },
    reflection: { summaryTemplate: "Day {{ time.day }}." },
  };
  const check = (doc: Record<string, unknown>, opts?: Parameters<typeof checkRuleModeReadiness>[1]) => {
    const r = validatePolicyDocument(doc);
    expect(r.policy).toBeDefined();
    return checkRuleModeReadiness(r.policy!, opts);
  };
  const errors = (issues: ReturnType<typeof check>) => issues.filter((i) => !i.warn).map((i) => i.path);
  const warnings = (issues: ReturnType<typeof check>) => issues.filter((i) => i.warn).map((i) => i.path);

  test("content with a catch-all line and its templates is ready", () => {
    expect(check(ready)).toEqual([]);
  });

  test("a fallback line is as good as a catch-all layer", () => {
    expect(errors(check({ ...base, render: { fallback: { text: "Hm." } }, reflection: { enabled: false } }))).toEqual([]);
  });

  test("without a catch-all line a turn could print only the built-in ellipsis", () => {
    const issues = check({ ...base, render: { layers: [{ id: "a", when: "event.positive", pool: [{ text: "Yay." }] }] }, reflection: { enabled: false } });
    expect(errors(issues)).toEqual(["render"]);
    expect(issues[0]!.message).toContain("render.fallback");
  });

  test("a narration layer is not a catch-all utterance", () => {
    const issues = check({ ...base, render: { layers: [{ id: "n", when: "true", pool: [{ text: "Rain.", style: "narration" }] }] }, reflection: { enabled: false } });
    expect(errors(issues)).toEqual(["render"]);
  });

  test("string keys must resolve in the locale chain", () => {
    const doc = {
      ...ready,
      render: { layers: [{ id: "any", when: "true", pool: [{ text: "$t:greet.hello" }, { text: "{{ t.greet.bye }} now" }] }] },
      choices: { enabled: true, rules: [{ text: "$t:choice.thanks", event_type: "praise" }] },
    };
    const known = new Set(["greet.hello"]);
    const issues = check(doc, { hasString: (k) => known.has(k) });
    expect(errors(issues)).toEqual(["render.layers[0].pool[1].text", "choices.rules[0].text"]);
    expect(issues.map((i) => i.message)).toContain('string key "greet.bye" is not defined for any locale of the chain');
    // without a resolver the keys are not checked
    expect(errors(check(doc))).toEqual([]);
  });

  test("features without their rule-mode template are reported as warnings, not errors", () => {
    const issues = check({
      ...base,
      render: { fallback: { text: "Hm." } },
      offscreen: { fidelity: { default: "narrate" } },
      scene: { autonomous: { maxExchangesPerPlayerTurn: 2 } },
      choices: { enabled: true },
    });
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues).sort()).toEqual(
      ["choices.rules", "offscreen.narrateTemplate", "reflection.summaryTemplate", "scene.autonomous.rules"].sort(),
    );
    expect(issues.every((i) => i.file === "policy")).toBe(true);
  });

  test("the issues carry the file name they were given", () => {
    const issues = check({ ...base }, { file: "policies/game.yaml" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.file === "policies/game.yaml")).toBe(true);
  });
});
