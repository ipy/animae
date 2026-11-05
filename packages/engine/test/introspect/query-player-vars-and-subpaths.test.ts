import { describe, expect, test } from "bun:test";
import { resolveQuery } from "../../src/introspect/query.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { createFakeKernel, charDef } from "../support/kernel-fake.ts";

describe("resolveQuery player vars and character subpaths", () => {
  test("player world vars hide non-public keys unless visibility grants them", () => {
    const { k } = createFakeKernel({
      policy: {
        visibility: {
          rules: [
            { viewer: "player", path: "world/vars", allow: true },
            { viewer: "player", path: "world/vars/secret", allow: true },
          ],
        },
      },
    });
    const canRead = () => true;
    const all = resolveQuery(k, "player", "world/vars", canRead) as Record<string, unknown>;
    expect(all.public).toBe(2);
    expect(all.secret).toBe(1);
    expect(resolveQuery(k, "player", "world/vars/public", canRead)).toBe(2);
    expect(resolveQuery(k, "player", "world/vars/secret", canRead)).toBe(1);
  });

  test("character traits, constraints, tracks, and alias nickname subpaths", () => {
    const { k, setState } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "player", path: "characters/npc1/*", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    setState({
      ...k.timeline.state(),
      aliases: { npc1: { aliases: {}, addressAs: {}, nickname: { label: "Nick", by: "player" } } },
    });
    const canRead = () => true;
    expect(resolveQuery(k, "player", "characters/npc1/traits", canRead)).toEqual({ event_mult: {} });
    expect(resolveQuery(k, "player", "characters/npc1/constraints", canRead)).toBeDefined();
    expect(resolveQuery(k, "player", "characters/npc1/tracks", canRead)).toMatchObject({ self: {}, toward: {} });
    expect(resolveQuery(k, "player", "characters/npc1/tiers", canRead)).toBeDefined();
    expect(resolveQuery(k, "player", "characters/npc1/goals", canRead)).toEqual([
      expect.objectContaining({ id: "g1", text: "survive" }),
    ]);
    expect(resolveQuery(k, "player", "characters/npc1/secrets", canRead)).toEqual([]);
    expect(resolveQuery(k, "player", "characters/npc1/alias/nickname", canRead)).toMatchObject({ label: "Nick" });
  });

  test("ledger returns empty list when fields service throws", () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "gm", path: "ledger", allow: true }] } },
      fields: {
        resolve: () => ({
          effects: { L0: {}, L1: {}, L2: {}, L3: {}, L4: {} },
          l3FieldRules: [],
          applied: [],
          maxLevel: 0,
          events: [],
        }),
        grant: async () => ({ eventId: "evt_0", kind: "field.granted", detail: {} }),
        revoke: async () => {},
        declare: () => {},
        onTurnEnd: async () => [],
        onSceneEnd: async () => [],
        ledger: () => {
          throw new Error("ledger unavailable");
        },
      } as never,
    });
    const canRead = () => true;
    expect(resolveQuery(k, "gm", "ledger", canRead)).toEqual([]);
  });

  test("l4ForOwner swallows field resolve errors for memory listing", async () => {
    const { k, setState } = createFakeKernel({
      policy: {
        visibility: {
          rules: [
            { viewer: "npc:npc1", path: "characters/npc1/memory", allow: true },
            { viewer: "npc:npc1", path: "characters/npc1", allow: true },
          ],
        },
      },
      fields: {
        resolve: () => {
          throw new Error("fields broken");
        },
      } as never,
    });
    k.m.memory = createMemoryService(k);
    await k.m.memory.write("npc1", {
      kind: "episodic",
      t: { day: 1, minute: 0 },
      text: "kept",
      tags: ["secret"],
      claims: [],
      importance: 0.5,
      valence: 0,
    });
    await k.m.memory.list("npc1");
    setState({
      ...k.timeline.state(),
      scene: {
        id: "scn_1",
        location: "loc",
        participants: ["npc1", "player"],
        turn: 1,
        startedAt: { day: 1, minute: 0 },
        fields: [],
      },
    });
    const canRead = () => true;
    const mem = resolveQuery(k, "npc:npc1", "characters/npc1/memory", canRead) as unknown[];
    expect(mem.length).toBe(1);
  });
});
