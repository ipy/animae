import { test, expect } from "bun:test";
import { assertAliasUniqueInScope, resolveEntityRef } from "../../src/entities/names.ts";
import { createFakeKernel, charDef } from "../support/kernel-fake.ts";
import { AnimaeError } from "../../src/types.ts";

test("resolveEntityRef throws ENTITY_AMBIGUOUS when two characters match", () => {
  const { k, setState } = createFakeKernel({
    chars: [
      { ...charDef("a1"), card: { ...charDef("a1").card, identity: { ...charDef("a1").card.identity, name: "Sam" } } },
      { ...charDef("a2"), card: { ...charDef("a2").card, identity: { ...charDef("a2").card.identity, name: "Sam" } } },
    ],
  });
  setState(k.timeline.state());
  expect(() => resolveEntityRef(k.timeline.state(), k.catalog, "Sam")).toThrow(AnimaeError);
});

test("assertAliasUniqueInScope rejects alias colliding with another character name", () => {
  const { k } = createFakeKernel({
    chars: [charDef("npc1"), { ...charDef("npc2"), card: { ...charDef("npc2").card, identity: { ...charDef("npc2").card.identity, name: "Unique" } } }],
  });
  expect(() => assertAliasUniqueInScope(k.timeline.state(), k.catalog, "npc1", "Unique")).toThrow(/collides with name/);
});
