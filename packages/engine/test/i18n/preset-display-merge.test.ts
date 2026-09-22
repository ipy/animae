import { expect, test } from "bun:test";
import {
  collectPresetDisplayStrings,
  mergeDisplayStringTables,
} from "../../src/i18n/preset-display-strings.ts";
import { createPresetRegistry } from "../../src/policy/registry.ts";
import presetBase from "../../../preset-base/src/index.ts";
import presetDnd from "../../../preset-dnd/src/index.ts";

const registry = createPresetRegistry([presetBase, presetDnd]);

test("later preset displayStrings override earlier keys per locale", () => {
  const fromChain = collectPresetDisplayStrings(registry, "@animae/preset-dnd");
  const overridden = mergeDisplayStringTables(fromChain, {
    en: { "dnd.check.perception_unusual": "Game override." },
  });
  expect(fromChain.en?.["dnd.check.insight_lie"]).toBeTruthy();
  expect(overridden.en?.["dnd.check.perception_unusual"]).toBe("Game override.");
  expect(overridden.en?.["dnd.check.insight_lie"]).toBe(fromChain.en?.["dnd.check.insight_lie"]);
});
