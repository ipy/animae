import { describe, expect, test } from "bun:test";
import { createIntrospect } from "../../src/introspect/service.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { createFakeKernel, charDef } from "../support/kernel-fake.ts";

/**
 * A rule on a parent path (`characters/<id>`, `world/locations`) covers its children, except where a rule names the
 * child path itself and denies it: the explicit deny must win, a grant must still beat it.
 */
describe("explicit child deny versus parent allow", () => {
  function setup() {
    const { k, setState } = createFakeKernel({
      chars: [charDef("npc1"), charDef("player")],
      policy: {
        visibility: {
          rules: [
            { viewer: "player", path: "characters/npc1", allow: true },
            { viewer: "player", path: "characters/npc1/memory", allow: false },
            { viewer: "player", path: "world/locations", allow: true },
            { viewer: "player", path: "world/locations/vault", allow: false },
          ],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    return { k, setState, intro: createIntrospect(k) };
  }

  test("a child path that no rule names inherits the parent's allow", () => {
    const { intro } = setup();
    expect(intro.query("player", "characters/npc1/identity")).toBeDefined();
    expect(intro.query("player", "characters/npc1/tracks")).toBeDefined();
    expect(intro.query("player", "world/locations/home")).toBeUndefined(); // unknown location id, not a visibility failure
  });

  test("an explicit deny on the child beats the parent's allow for character sub-paths", () => {
    const { intro } = setup();
    expect(intro.query("player", "characters/npc1/memory")).toBeUndefined();
    // The deny is specific to the named path: siblings keep working.
    expect(intro.query("player", "characters/npc1/identity")).toBeDefined();
  });

  test("an explicit deny on a location beats the allow on world/locations", () => {
    const { k, setState, intro } = setup();
    setState({
      ...k.timeline.state(),
      locations: {
        vault: { id: "vault", name: "Vault", vars: {}, lastSimulated: null } as never,
        hall: { id: "hall", name: "Hall", vars: {}, lastSimulated: null } as never,
      },
    });
    expect(intro.query("player", "world/locations/vault")).toBeUndefined();
    expect(intro.query("player", "world/locations/hall")).toMatchObject({ id: "hall" });
  });

  test("an active grant on the denied path lifts the deny", async () => {
    const { intro } = setup();
    expect(intro.query("player", "characters/npc1/memory")).toBeUndefined();
    await intro.grant("player", "characters/npc1/memory");
    expect(intro.query("player", "characters/npc1/memory")).toEqual([]);
    await intro.revoke("player", "characters/npc1/memory");
    expect(intro.query("player", "characters/npc1/memory")).toBeUndefined();
  });

  test("debug is never denied", () => {
    const { intro } = setup();
    expect(intro.query("debug", "characters/npc1/memory")).toEqual([]);
  });
});
