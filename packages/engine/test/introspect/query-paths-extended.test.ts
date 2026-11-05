import { describe, expect, test } from "bun:test";
import { resolveQuery } from "../../src/introspect/query.ts";
import { createIntrospect } from "../../src/introspect/service.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { createFakeKernel, charDef } from "../support/kernel-fake.ts";

describe("resolveQuery extended paths", () => {
  test("npc viewer sees L4 disguise and hidden entities on character summary", () => {
    const { k, setState } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "npc:npc1", path: "characters/npc1", allow: true }] } },
      fields: {
        resolve: () => ({
          effects: {
            L0: {},
            L1: {},
            L2: {},
            L3: {},
            L4: { hide_entities: ["ghost"], disguise: { name: "Alias" }, inject_belief: [{ text: "belief" }] },
          },
          l3FieldRules: [],
          applied: [],
          maxLevel: 4,
          events: [],
        }),
        grant: async () => ({ eventId: "evt_0", kind: "field.granted", detail: {} }),
        revoke: async () => {},
        declare: () => {},
        onTurnEnd: async () => [],
        onSceneEnd: async () => [],
        ledger: () => [{ id: "f1" }],
      } as never,
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    const summary = intro.query("npc:npc1", "characters/npc1") as Record<string, unknown>;
    expect(summary.hidden_from_self).toEqual(["ghost"]);
    expect(summary.disguise).toEqual({ name: "Alias" });
    expect(summary.injected_beliefs).toEqual([{ text: "belief" }]);
    expect(intro.query("debug", "characters/npc1/card")).toBeDefined();
    expect(intro.query("player", "characters/npc1/card")).toBeUndefined();
  });

  test("world locations, items, time, ledger, and events paths", async () => {
    const { k, setState } = createFakeKernel({
      policy: {
        visibility: {
          rules: [
            { viewer: "player", path: "world/locations", allow: true },
            { viewer: "player", path: "world/items", allow: true },
            { viewer: "player", path: "world/time", allow: true },
            { viewer: "player", path: "ledger", allow: true },
            { viewer: "player", path: "events", allow: true },
          ],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    setState({
      ...k.timeline.state(),
      items: { key: { id: "key", name: "Key", holder: { kind: "character", ref: "player" }, vars: {} } },
    });
    await k.timeline.append([{ kind: "narration", style: "normal", text: "Hi", source: "test" }], {
      turn: "turn_1",
      scene: "scn_1",
    });
    const intro = createIntrospect(k);
    expect((intro.query("player", "world/locations") as unknown[]).length).toBeGreaterThan(0);
    expect((intro.query("player", "world/items") as unknown[])[0]).toMatchObject({ id: "key" });
    expect(intro.query("player", "world/time")).toMatchObject({ hhmm: expect.any(String) });
    expect(intro.query("player", "ledger")).toEqual([]);
    const events = intro.query("player", "events") as unknown[];
    expect(events.some((e) => (e as { kind: string }).kind === "narration")).toBe(true);
  });

  test("resolveQuery returns undefined for unknown character subpaths", () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "player", path: "characters/npc1", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    const canRead = () => true;
    expect(resolveQuery(k, "player", "characters/npc1/unknown", canRead)).toBeUndefined();
  });
});
