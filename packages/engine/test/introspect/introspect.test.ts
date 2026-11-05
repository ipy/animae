import { test, expect, describe } from "bun:test";
import { createIntrospect } from "../../src/introspect/service.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { createFakeKernel, charDef } from "../support/kernel-fake.ts";
import { globMatch, evaluateVisibility, eventVisible, narrationVisibilityPaths } from "../../src/introspect/visibility.ts";
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

  test("narration path rules can hide scene breaks", () => {
    const policy = applyPolicyDefaults({
      visibility: {
        rules: [
          { viewer: "player", path: "events", allow: true },
          { viewer: "player", path: "events/narration/style:scene_break", allow: false },
        ],
      },
    });
    expect(narrationVisibilityPaths("scene_break")).toEqual(["events/narration", "events/narration/style:scene_break"]);
    expect(eventVisible(policy, "player", { kind: "narration", style: "scene_break" }, [], { day: 1, minute: 0 })).toBe(false);
    expect(eventVisible(policy, "player", { kind: "narration", style: "normal" }, [], { day: 1, minute: 0 })).toBe(true);
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

  test("grant and expiry are logged with the viewer, the normalised path and the deadline", async () => {
    const { k, setState } = createFakeKernel({
      policy: {
        visibility: {
          rules: [
            { viewer: "player", path: "ledger", allow: false },
            { viewer: "player", path: "director/anchors", allow: false },
          ],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    await intro.grant("player", "/ledger", 60);
    await intro.grant("player", "director/anchors"); // no TTL: lasts until revoked

    const granted = k.timeline.events().filter((e) => e.kind === "visibility.granted") as unknown as Array<{
      viewer: string;
      path: string;
      source?: string;
      expiresAt?: { day: number; minute: number };
    }>;
    expect(granted.map((e) => [e.viewer, e.path, e.source, e.expiresAt])).toEqual([
      ["player", "ledger", "introspect", { day: 1, minute: 60 }],
      ["player", "director/anchors", "introspect", undefined],
    ]);

    // Nothing has lapsed yet; two hours later only the grant with a deadline does.
    expect(await intro.expireGrants()).toEqual([]);
    setState({ ...k.timeline.state(), time: { day: 1, minute: 120 } });
    const expired = await intro.expireGrants();
    expect(expired.map((e) => e.kind)).toEqual(["visibility.expired"]);
    expect(expired[0]).toMatchObject({ viewer: "player", path: "ledger", source: "introspect" });
    expect(intro.canRead("player", "ledger")).toBe(false);
    expect(intro.canRead("player", "director/anchors")).toBe(true);
  });

  test("revoke ends a grant before its TTL and leaves other grants alone", async () => {
    const { k } = createFakeKernel({
      policy: {
        visibility: {
          rules: [
            { viewer: "player", path: "ledger", allow: false },
            { viewer: "player", path: "director/anchors", allow: false },
          ],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    await intro.grant("player", "ledger", 600);
    await intro.grant("player", "director/anchors", 600);
    expect(intro.canRead("player", "ledger")).toBe(true);

    await intro.revoke("player", "ledger");
    expect(intro.canRead("player", "ledger")).toBe(false);
    expect(intro.query("player", "ledger")).toBeUndefined();
    expect(intro.canRead("player", "director/anchors")).toBe(true);
  });

  test("revoke is a no-op without an active grant and does not write events", async () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "player", path: "ledger", allow: false }] } },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    const before = k.timeline.events().length;
    await intro.revoke("player", "ledger");
    expect(k.timeline.events().length).toBe(before);
    expect(intro.canRead("player", "ledger")).toBe(false);
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
          l3FieldRules: [],
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
