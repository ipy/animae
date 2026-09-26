import { describe, expect, test } from "bun:test";
import { ReflectionOutputSchema } from "../../src/memory/reflection.ts";
import { buildReflectionPromptSegments } from "../../src/memory/reflect-prompt.ts";
import { lintAssembledPrompt } from "../../src/pipeline/prompt-lint.ts";
import { createPipelineKernel, charDef } from "./test-kernel.ts";

describe("reflection prompt", () => {
  test("builds static role text and prose narrative without raw JSON events", async () => {
    const { k, setState } = createPipelineKernel({ chars: [charDef("mira"), charDef("player")] });
    const sceneId = "scn_test";
    setState({
      ...k.timeline.state(),
      scene: { id: sceneId, location: "hall", participants: ["mira", "player"], turn: 1, startedAt: { day: 1, minute: 0 }, fields: [] },
    });
    await k.timeline.append([
      { kind: "utterance", scene: sceneId, speaker: "player", text: "Hello there.", source: "test" },
      {
        kind: "track.delta",
        scene: sceneId,
        owner: "mira",
        track: "mood",
        delta: -0.01,
        reason: "decay",
        source: "test",
      },
    ] as never);
    const segments = buildReflectionPromptSegments(k, sceneId, "mira");
    const blob = [segments.static, segments.dynamic, segments.user].join("\n");
    expect(segments.static.length).toBeGreaterThan(40);
    expect(blob).not.toContain("track.delta");
    expect(blob).not.toContain("evt_");
    expect(lintAssembledPrompt(blob).length).toBe(0);
  });

  // The model only sees this text: naming a field without its item shape made a real model answer `new_claims` with
  // plain strings and `goal_changes` with made-up actions, so every reflection was rejected by the schema.
  for (const promptLocale of ["en", "zh-CN"]) {
    test(`${promptLocale}: spells out every output field with the shape of its items`, () => {
      const { k } = createPipelineKernel({ chars: [charDef("mira"), charDef("player")], i18n: { promptLocale } });
      const { static: text } = buildReflectionPromptSegments(k, "scn_test", "mira");
      for (const field of Object.keys(ReflectionOutputSchema.shape)) expect(text).toContain(`\`${field}\``);
      for (const key of ["action", "id", "text", "tags", "s", "p", "o"]) expect(text).toContain(`"${key}"`);
      for (const action of ["add", "update", "remove"]) expect(text).toContain(action);
      expect(lintAssembledPrompt(text)).toEqual([]);
    });
  }

  test("lists the character's current goals with their ids so update/remove can name one", () => {
    const { k } = createPipelineKernel({ chars: [charDef("mira"), charDef("player")] });
    const { dynamic } = buildReflectionPromptSegments(k, "scn_test", "mira");
    expect(dynamic).toContain("g1");
    expect(dynamic).toContain("survive");
    expect(lintAssembledPrompt(dynamic)).toEqual([]);
  });
});
