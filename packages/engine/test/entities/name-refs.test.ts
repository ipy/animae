import { describe, expect, test } from "bun:test";
import { expandNameRefs, hasNameRefs, nameRefIds } from "../../src/entities/name-refs.ts";
import { charDef, createFakeKernel } from "../support/kernel-fake.ts";

function kernelWith(names: Record<string, string>) {
  const chars = Object.entries(names).map(([id, name]) => {
    const def = charDef(id);
    def.card.identity.name = name;
    return def;
  });
  return createFakeKernel({ chars });
}

describe("name references", () => {
  test("a reference resolves to the card name", () => {
    const { k } = kernelWith({ player: "Mira", npc1: "Odo" });
    const view = { state: k.timeline.state(), catalog: k.catalog };
    expect(expandNameRefs("{{name:npc1}} waves at {{name:player}}.", view)).toBe("Odo waves at Mira.");
  });

  test("a runtime nickname wins over the card name, for every occurrence", () => {
    const { k, setState } = kernelWith({ player: "Mira", npc1: "Odo" });
    setState({
      ...k.timeline.state(),
      aliases: { player: { aliases: {}, addressAs: {}, nickname: { label: "Sol", by: "player" } } },
    });
    const view = { state: k.timeline.state(), catalog: k.catalog };
    expect(expandNameRefs("{{name:player}} asks {{name:npc1}}; {{name:player}} waits.", view)).toBe("Sol asks Odo; Sol waits.");
  });

  test("whitespace inside the marker is tolerated and unknown ids fall back to the id, never to marker syntax", () => {
    const { k } = kernelWith({ player: "Mira" });
    const view = { state: k.timeline.state(), catalog: k.catalog };
    expect(expandNameRefs("{{ name : player }} and {{name:ghost}}", view)).toBe("Mira and ghost");
  });

  test("text without markers is returned untouched, other template variables are not matched", () => {
    const { k } = kernelWith({ player: "Mira" });
    const view = { state: k.timeline.state(), catalog: k.catalog };
    const plain = "{{name}} is {{nickname}}; nothing to expand";
    expect(expandNameRefs(plain, view)).toBe(plain);
    expect(hasNameRefs(plain)).toBe(false);
    expect(hasNameRefs("see {{name:player}}")).toBe(true);
  });

  test("nameRefIds lists each referenced id once, in order", () => {
    expect(nameRefIds("{{name:b}} {{name:a}} {{name:b}} {{name}}")).toEqual(["b", "a"]);
    expect(nameRefIds("no markers")).toEqual([]);
  });
});
