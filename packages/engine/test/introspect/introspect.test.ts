import { test, expect, describe } from "bun:test";
import { createIntrospect } from "../../src/introspect/service.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { createFakeKernel, charDef } from "../support/kernel-fake.ts";
import { globMatch, evaluateVisibility } from "../../src/introspect/visibility.ts";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";

describe("visibility", () => {
  test("glob patterns", () => {
    expect(globMatch("characters/*", "characters/npc1")).toBe(true);
    expect(globMatch("world/**", "world/vars/x")).toBe(false);
    expect(globMatch("npc:*", "npc:npc1")).toBe(true);
  });

  test("last rule wins and default deny", () => {
    const policy = applyPolicyDefaults({
      visibility: {
        rules: [
          { viewer: "player", path: "characters/*", allow: false },
          { viewer: "player", path: "characters/npc1", allow: true },
        ],
      },
    });
    expect(evaluateVisibility(policy, "player", "characters/npc1", [], { day: 1, minute: 0 })).toBe(true);
    expect(evaluateVisibility(policy, "player", "characters/npc2", [], { day: 1, minute: 0 })).toBe(false);
    expect(evaluateVisibility(policy, "player", "ledger", [], { day: 1, minute: 0 })).toBe(false);
  });

  test("debug bypasses policy", () => {
    const policy = applyPolicyDefaults({ visibility: { rules: [] } });
    expect(evaluateVisibility(policy, "debug", "anything", [], { day: 1, minute: 0 })).toBe(true);
  });
});

describe("introspect query", () => {
  test("denied returns undefined", () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "player", path: "ledger", allow: false }] } },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    expect(intro.query("player", "ledger")).toBeUndefined();
  });

  test("player world vars public only", () => {
    const { k } = createFakeKernel({
      policy: {
        visibility: {
          rules: [
            { viewer: "player", path: "world/vars", allow: true },
            { viewer: "player", path: "world/vars/secret", allow: false },
          ],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    const vars = intro.query("player", "world/vars") as Record<string, unknown>;
    expect(vars.public).toBe(2);
    expect(vars.secret).toBeUndefined();
  });

  test("grant and expire", async () => {
    const { k, setState } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "player", path: "ledger", allow: false }] } },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    expect(intro.query("player", "ledger")).toBeUndefined();
    await intro.grant("player", "ledger", 60);
    expect(intro.query("player", "ledger")).toBeDefined();
    setState({ ...k.timeline.state(), time: { day: 1, minute: 120 } });
    await intro.expireGrants();
    expect(intro.canRead("player", "ledger")).toBe(false);
    expect(intro.query("player", "ledger")).toBeUndefined();
  });

  test("L4 suppress memory tags on self view", async () => {
    const { k } = createFakeKernel({
      policy: {
        visibility: {
          rules: [{ viewer: "npc:*", path: "characters/*/**", allow: true }],
        },
      },
      fields: {
        resolve: () => ({
          effects: { L0: {}, L1: {}, L2: {}, L3: {}, L4: { suppress_memory_tags: ["secret"] } },
          applied: [],
          maxLevel: 4,
          events: [],
        }),
        grant: async () => ({ eventId: "evt_0000", kind: "field.granted", detail: {} }),
        revoke: async () => {},
        declare: () => {},
        onTurnEnd: async () => [],
        onSceneEnd: async () => [],
        ledger: () => [],
      } as import("../../src/contracts.ts").FieldSystem,
    });
    k.m.memory = createMemoryService(k);
    const mem = k.m.memory;
    await mem.list("npc1");
    await mem.write("npc1", {
      kind: "episodic",
      t: { day: 1, minute: 0 },
      text: "hidden",
      tags: ["secret"],
      claims: [],
      importance: 0.5,
      valence: 0,
    });
    await mem.list("npc1");
    const intro = createIntrospect(k);
    const list = intro.query("npc:npc1", "characters/npc1/memory") as { tags: string[] }[];
    expect(list.every((e) => !e.tags.includes("secret"))).toBe(true);
  });

  test("immutability of query result", async () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "gm", path: "world/vars", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    const vars = intro.query("gm", "world/vars") as Record<string, unknown>;
    expect(() => {
      vars.public = 999;
    }).toThrow();
  });

  test("explain filters by event visibility kinds", async () => {
    const { k } = createFakeKernel({
      policy: {
        visibility: {
          rules: [
            { viewer: "player", path: "events", allow: true, kinds: ["utterance"] },
          ],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    const turnId = "turn_test";
    await k.emit([
      { kind: "input.received", source: "test", actor: "player", text: "hi", turn: turnId },
      { kind: "utterance", source: "test", speaker: "npc1", text: "hello", cues: [], turn: turnId },
    ]);
    const turn = turnId;
    const intro = createIntrospect(k);
    const ex = intro.explain(turn, "player");
    expect(ex.chain.every((c) => c.kind === "utterance" || c.kind === "retrieval")).toBe(true);
  });

  test("alias paths expose runtime nicknames and address labels", async () => {
    const { k } = createFakeKernel({
      chars: [charDef("npc1"), charDef("player", "supporting")],
      policy: { visibility: { rules: [{ viewer: "player", path: "characters/npc1", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);

    expect(intro.query("player", "characters/npc1/alias")).toEqual({ aliases: {}, addressAs: {} });
    expect(intro.query("player", "characters/npc1/alias/nickname")).toBeUndefined();

    await k.emit([
      { kind: "entity.alias_set", source: "test", entity: "npc1", nickname: { label: "Nic", by: "player" } },
      { kind: "entity.alias_set", source: "test", entity: "npc1", addressAs: { target: "player", label: "boss", by: "player" } },
    ]);

    expect(intro.query("player", "characters/npc1/alias/nickname")).toEqual({ label: "Nic", by: "player" });
    const view = intro.query("player", "characters/npc1/alias") as {
      nickname?: { label: string };
      addressAs: Record<string, Record<string, { label: string }>>;
    };
    expect(view.nickname?.label).toBe("Nic");
    expect(view.addressAs.npc1?.player?.label).toBe("boss");

    await k.emit([{ kind: "entity.alias_set", source: "test", entity: "npc1", nickname: null }]);
    expect(intro.query("player", "characters/npc1/alias/nickname")).toBeUndefined();
  });

  test("the full authored card is readable by the debug viewer only", () => {
    const { k } = createFakeKernel({
      chars: [charDef("npc1")],
      // Access to the character itself opens its sub-paths, but not its raw card.
      policy: { visibility: { rules: [{ viewer: "player", path: "characters/npc1", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    expect(intro.query("player", "characters/npc1/identity")).toBeDefined();
    expect(intro.query("player", "characters/npc1/card")).toBeUndefined();
    const card = intro.query("debug", "characters/npc1/card") as { identity?: { name?: string } } | undefined;
    expect(card?.identity?.name).toBeDefined();
  });

  test("alias paths follow the character visibility rules", () => {
    const { k } = createFakeKernel({
      chars: [charDef("npc1"), charDef("player", "supporting")],
      policy: { visibility: { rules: [{ viewer: "player", path: "characters/npc1", allow: false }] } },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    expect(intro.query("player", "characters/npc1/alias")).toBeUndefined();
    expect(intro.query("debug", "characters/npc1/alias")).toEqual({ aliases: {}, addressAs: {} });
  });

  test("characters list filtered", () => {
    const { k } = createFakeKernel({
      chars: [charDef("npc1"), charDef("npc2")],
      policy: {
        visibility: {
          rules: [
            { viewer: "player", path: "characters", allow: true },
            { viewer: "player", path: "characters/npc1", allow: true },
            { viewer: "player", path: "characters/npc2", allow: false },
          ],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    const list = intro.query("player", "characters") as { id: string }[];
    expect(list.map((c) => c.id)).toEqual(["npc1"]);
  });
});
