import { describe, expect, test } from "bun:test";
import { adjudicateProposal, nextLod, LOD_RANK } from "../../src/entities/adjudicate.ts";
import { AnimaeError } from "../../src/types.ts";
import type { Catalog } from "../../src/contracts.ts";
import { TemplateSchema } from "../../src/schema/authored.ts";

const emptyCatalog: Catalog = {
  character: () => undefined,
  characters: () => [],
  location: () => undefined,
  locations: () => [],
  item: () => undefined,
  template: () => undefined,
  knowledge: () => [],
};

const charTemplate = TemplateSchema.parse({
  fields: {},
  defaults: { persona: "base persona", tags: ["npc"] },
  lod: "supporting",
});

const locTemplate = TemplateSchema.parse({ fields: {}, defaults: { summary: "A room" } });
const itemTemplate = TemplateSchema.parse({ fields: {}, defaults: {} });

describe("adjudicateProposal", () => {
  test("builds character def from merged template and proposal", () => {
    const { ref, data } = adjudicateProposal(
      "character",
      charTemplate,
      { identity: { name: "Rin", summary: "traveler" }, persona: "wanderer" },
      emptyCatalog,
      { id: "rin-traveler" },
    );
    expect(ref).toEqual({ kind: "character", id: "rin-traveler" });
    expect(data.id).toBe("rin-traveler");
    expect((data as { persona: string }).persona).toBe("wanderer");
  });

  test("location and item kinds produce defs", () => {
    const loc = adjudicateProposal("location", locTemplate, { name: "Hall" }, emptyCatalog);
    expect(loc.ref.kind).toBe("location");
    expect(loc.data.name).toBe("Hall");

    const item = adjudicateProposal(
      "item",
      itemTemplate,
      { name: "Key", holder: { kind: "character", ref: "player" } },
      emptyCatalog,
    );
    expect(item.ref.kind).toBe("item");
    expect((item.data as { holder: unknown }).holder).toEqual({ kind: "character", ref: "player" });
  });

  test("duplicate id throws", () => {
    const catalog: Catalog = {
      ...emptyCatalog,
      character: (id) => (id === "taken" ? ({ id: "taken" } as never) : undefined),
    };
    expect(() => adjudicateProposal("character", charTemplate, { name: "X" }, catalog, { id: "taken" })).toThrow(AnimaeError);
  });

  test("invalid bottom_lines throw ENTITY_INVALID", () => {
    expect(() =>
      adjudicateProposal("character", charTemplate, { constraints: { bottom_lines: [{ bad: true }] } }, emptyCatalog),
    ).toThrow(AnimaeError);
  });
});

describe("LOD helpers", () => {
  test("nextLod progression and ranks", () => {
    expect(nextLod("extra")).toBe("supporting");
    expect(nextLod("supporting")).toBe("principal");
    expect(nextLod("principal")).toBeUndefined();
    expect(LOD_RANK.principal).toBeGreaterThan(LOD_RANK.extra);
  });
});
