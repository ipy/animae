import { test, expect } from "bun:test";
import { assertAliasUniqueInScope } from "../../src/entities/names.ts";
import { createFakeKernel, charDef } from "../support/kernel-fake.ts";

test("assertAliasUniqueInScope rejects normalized alias key already registered on another entity", () => {
  const { k, setState } = createFakeKernel({ chars: [charDef("npc1"), charDef("npc2")] });
  setState({
    ...k.timeline.state(),
    aliases: {
      npc2: {
        aliases: { taken: { label: "Taken", by: "player" } },
        addressAs: {},
      },
    },
  });
  expect(() => assertAliasUniqueInScope(k.timeline.state(), k.catalog, "npc1", "Taken")).toThrow(/already used by npc2/);
});
