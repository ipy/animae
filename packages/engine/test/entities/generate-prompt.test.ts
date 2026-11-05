import { describe, expect, test } from "bun:test";
import type { Kernel } from "../../src/contracts.ts";
import { buildEntityGeneratePrompt, buildEntityPromotePrompt } from "../../src/entities/generate-prompt.ts";
import type { Template } from "../../src/schema/authored.ts";
import { charDef, createPipelineKernel } from "../pipeline/test-kernel.ts";

const template = (over: Partial<Template> = {}): Template => ({
  id: "villager",
  kind: "character",
  fields: {},
  guidance: "Keep them humble.",
  defaults: {},
  promote: [],
  ...over,
});

function kernel(): { k: Kernel; setState: ReturnType<typeof createPipelineKernel>["setState"] } {
  const { k, setState } = createPipelineKernel({ chars: [charDef("npc1"), charDef("player")] });
  Object.assign(k.authored.world, { rules_text: "Magic is rare in this valley." });
  return { k, setState };
}

describe("entity generation prompt", () => {
  test("static: world rules, then the output language, then the template guidance", () => {
    const { k } = kernel();
    const p = buildEntityGeneratePrompt(k, template(), { kind: "character", template: "villager" }, "fr");
    const order = ["World rules:\nMagic is rare in this valley.", "Output language: French (fr).", "Template guidance:\nKeep them humble."];
    let at = -1;
    for (const part of order) {
      const found = p.static.indexOf(part);
      expect(found, part).toBeGreaterThan(at);
      at = found;
    }
    expect(p.semiStatic).toBe("");
  });

  test("the policy's own world facts replace the world's rules text", () => {
    const { k } = kernel();
    Object.assign(k.policy, { x: { ...k.policy.x, prompt: { world_facts: "The valley is cut off by snow." } } });
    const { static: text } = buildEntityGeneratePrompt(k, template(), { kind: "character", template: "villager" }, "en");
    expect(text).toContain("World rules:\nThe valley is cut off by snow.");
    expect(text).not.toContain("Magic is rare");
  });

  test("without world rules or guidance the static part is just the language instruction", () => {
    const { k } = createPipelineKernel({ chars: [charDef("npc1")] });
    const p = buildEntityGeneratePrompt(k, template({ guidance: "" }), { kind: "character", template: "villager" }, "en");
    expect(p.static).toBe("Output language: English (en). All generated text must use this language.");
  });

  test("dynamic: hints in key order, then the names already taken by that kind of entity", () => {
    const { k } = kernel();
    const p = buildEntityGeneratePrompt(k, template(), { kind: "character", template: "villager", hints: { trade: " smith ", age: 40 } }, "en");
    expect(p.dynamic).toBe("Hints:\n- age: 40\n- trade: smith\n\nAvoid duplicating these names: npc1, player");
    expect(buildEntityGeneratePrompt(k, template(), { kind: "character", template: "villager", hints: {} }, "en").dynamic).toBe(
      "Avoid duplicating these names: npc1, player",
    );
  });

  test("the names to avoid come from the catalog of the requested kind: locations, and authored plus generated items", () => {
    const { k, setState } = kernel();
    Object.assign(k.authored.items, { lamp: { id: "lamp", name: "Brass Lamp", summary: "", tags: [], vars: {} } });
    setState({
      ...k.timeline.state(),
      generated: {
        ...k.timeline.state().generated,
        items: { coin: { id: "coin", name: "Old Coin", summary: "", tags: [], vars: {} } },
      } as never,
    });
    const names = (kind: "location" | "item") =>
      buildEntityGeneratePrompt(k, template({ kind }), { kind, template: "t" }, "en").dynamic;
    expect(names("location")).toBe("Avoid duplicating these names: Loc");
    expect(names("item")).toBe("Avoid duplicating these names: Brass Lamp, Old Coin");
  });

  test("user: asks for a structured proposal of the kind, naming the template", () => {
    const { k } = kernel();
    for (const kind of ["character", "location", "item"] as const) {
      const p = buildEntityGeneratePrompt(k, template({ kind }), { kind, template: "villager" }, "en");
      expect(p.user).toBe(`Generate a structured ${kind} proposal for template "villager". Fill every required schema field.`);
    }
  });
});

describe("entity promotion prompt", () => {
  test("carries the current definition, the step being taken and the target level", () => {
    const { k } = kernel();
    const p = buildEntityPromotePrompt(k, template(), '{"id":"npc1"}', "extra", "supporting", "en");
    expect(p.static).toContain("Template guidance:\nKeep them humble.");
    expect(p.static).toContain("World rules:\nMagic is rare in this valley.");
    expect(p.semiStatic).toContain('{"id":"npc1"}');
    expect(p.dynamic).toContain("extra");
    expect(p.dynamic).toContain("supporting");
    expect(p.user).toContain("supporting");
  });
});
