import { describe, expect, test } from "bun:test";
import {
  assertAliasUniqueInScope,
  authoredFieldPlain,
  entityDisplayName,
  normalizeAliasKey,
  resolveEntityRef,
} from "../../src/entities/names.ts";
import { createFakeKernel, charDef } from "../support/kernel-fake.ts";
import { AnimaeError } from "../../src/types.ts";

describe("entity names", () => {
  test("authoredFieldPlain unwraps string-table shapes", () => {
    expect(authoredFieldPlain("plain")).toBe("plain");
    expect(authoredFieldPlain({ $t: "hero.name" })).toBe("hero.name");
    expect(authoredFieldPlain({ i18n: { key: "npc.label" } })).toBe("npc.label");
    expect(authoredFieldPlain(null)).toBe("");
  });

  test("entityDisplayName respects retired, address-as, nickname, localized", () => {
    const { k, setState } = createFakeKernel({
      chars: [
        {
          ...charDef("npc1"),
          card: {
            ...charDef("npc1").card,
            identity: { ...charDef("npc1").card.identity, name: "Canonical", nickname: "Nick" },
          },
        },
        charDef("player"),
      ],
    });
    let state = k.timeline.state();
    state = {
      ...state,
      aliases: {
        npc1: {
          aliases: {},
          addressAs: { player: { player: { label: "Dear friend", by: "npc1" } } },
          nickname: { label: "Runtime nick", by: "player" },
        },
      },
    };
    setState(state);
    expect(entityDisplayName(state, k.catalog, "npc1", { viewer: "player", speaker: "player" })).toBe("Dear friend");
    expect(entityDisplayName(state, k.catalog, "npc1")).toBe("Runtime nick");
    const noRuntimeNick = {
      ...state,
      aliases: { npc1: { aliases: {}, addressAs: {} } },
    };
    expect(
      entityDisplayName(noRuntimeNick, k.catalog, "npc1", {
        localized: (_id, field) => (field === "nickname" ? "Localized" : undefined),
      }),
    ).toBe("Localized");

    setState({ ...state, retired: { npc1: true } });
    expect(entityDisplayName(k.timeline.state(), k.catalog, "npc1")).toBe("Canonical");
  });

  test("resolveEntityRef matches id, canonical name, nickname, aliases; ambiguity throws", () => {
    const { k, setState } = createFakeKernel({
      chars: [
        {
          ...charDef("alpha"),
          card: { ...charDef("alpha").card, identity: { ...charDef("alpha").card.identity, name: "Alpha", nickname: "Al" } },
        },
        charDef("beta"),
      ],
    });
    const state = {
      ...k.timeline.state(),
      aliases: { beta: { aliases: { buddy: { label: "Buddy", by: "player" } }, addressAs: {} } },
    };
    setState(state);
    expect(resolveEntityRef(state, k.catalog, "alpha").id).toBe("alpha");
    expect(resolveEntityRef(state, k.catalog, "Alpha").id).toBe("alpha");
    expect(resolveEntityRef(state, k.catalog, "Al").id).toBe("alpha");
    expect(resolveEntityRef(state, k.catalog, "buddy").id).toBe("beta");
    expect(() => resolveEntityRef(state, k.catalog, "")).toThrow(AnimaeError);
    expect(() => resolveEntityRef(state, k.catalog, "missing")).toThrow(AnimaeError);
  });

  test("assertAliasUniqueInScope rejects duplicate runtime nickname", () => {
    const { k, setState } = createFakeKernel({ chars: [charDef("npc1"), charDef("npc2")] });
    setState({
      ...k.timeline.state(),
      aliases: { npc2: { aliases: {}, addressAs: {}, nickname: { label: "Taken", by: "player" } } },
    });
    expect(() => assertAliasUniqueInScope(k.timeline.state(), k.catalog, "npc1", "Taken")).toThrow(/already used/);
  });

  test("normalizeAliasKey trims and lowercases", () => {
    expect(normalizeAliasKey("  Foo  ")).toBe("foo");
  });
});
