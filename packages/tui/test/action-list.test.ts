import { describe, expect, test } from "bun:test";
import {
  autocompleteSuggestions,
  buildPaletteEntries,
  listEntityActions,
  listToolbarActions,
} from "../src/utils/action-list.ts";
import { fuzzyScore } from "../src/utils/fuzzy-match.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { createTestCommandApi } from "./helpers/command-api-test.ts";
import type { ActionContext, CustomCommand, EntityTuiAction, TuiAction } from "../src/types.ts";

const ctx = (): ActionContext => ({
  engine: createTuiFakeEngine(),
  viewer: "player",
  actor: "player",
  sceneId: () => "scn_0001",
  focusTarget: "mira",
  commandApi: createTestCommandApi().api,
});

const i18n = {
  t: (k: string) => k,
  has: (k: string) => k.startsWith("command.desc."),
};

describe("action-list", () => {
  test("listToolbarActions and listEntityActions honour when", () => {
    const actions: TuiAction[] = [
      { id: "a1", label: "Always", run: () => {} },
      { id: "a2", label: "Hidden", toolbar: false, run: () => {} },
      { id: "a3", label: "Cond", when: (c) => c.focusTarget === "mira", run: () => {} },
    ];
    const visible = listToolbarActions(actions, ctx());
    expect(visible.map((a) => a.id)).toEqual(["a1", "a3"]);
    const entityActions: EntityTuiAction[] = [
      { id: "e1", label: "Talk", run: () => {} },
      { id: "e2", label: "Skip", when: (_c, id) => id === "mira", run: () => {} },
    ];
    expect(listEntityActions(entityActions, ctx(), "mira").map((a) => a.id)).toEqual(["e1", "e2"]);
    expect(listEntityActions(entityActions, ctx(), "other").map((a) => a.id)).toEqual(["e1"]);
  });

  test("buildPaletteEntries includes commands and fuzzy filter", () => {
    const custom: Record<string, CustomCommand> = {
      ping: { description: "Ping", run: async () => {} },
    };
    const all = buildPaletteEntries("", ctx(), [], [], custom, "mira", i18n);
    expect(all.some((e) => e.commandName === "save")).toBe(true);
    expect(all.some((e) => e.commandName === "ping")).toBe(true);
    const filtered = buildPaletteEntries("save", ctx(), [], [], custom, undefined, i18n);
    expect(filtered.some((e) => e.commandName === "save")).toBe(true);
    expect(
      filtered.every(
        (e) => fuzzyScore("save", `${e.label} ${e.hint ?? ""}`) !== undefined,
      ),
    ).toBe(true);
  });

  test("autocompleteSuggestions for commands and name hints", () => {
    const cmds: Record<string, CustomCommand> = { custom: { description: "c", run: async () => {} } };
    expect(autocompleteSuggestions(":sa", cmds, [])).toContain(":save");
    expect(autocompleteSuggestions("mir", cmds, ["Mira", "Bob"])).toContain("Mira");
  });
});
