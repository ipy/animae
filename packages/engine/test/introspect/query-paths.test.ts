import { describe, expect, test } from "bun:test";
import { createIntrospect, resolveNpcSelfQueryPath } from "../../src/introspect/service.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { entityRefForQueryCatchUp } from "../../src/introspect/query-catchup.ts";
import { createFakeKernel, charDef } from "../support/kernel-fake.ts";

describe("query path branches", () => {
  test("npc self alias rewrites paths", () => {
    expect(resolveNpcSelfQueryPath("npc:npc1", "characters/self/identity")).toBe("characters/npc1/identity");
    expect(resolveNpcSelfQueryPath("player", "characters/self/identity")).toBe("characters/self/identity");
  });

  test("world, scene, director, budget, timeline paths", async () => {
    const { k, setState } = createFakeKernel({
      chars: [charDef("npc1"), charDef("player")],
      policy: {
        visibility: {
          rules: [
            { viewer: "gm", path: "world/*", allow: true },
            { viewer: "gm", path: "scene", allow: true },
            { viewer: "gm", path: "director/*", allow: true },
            { viewer: "gm", path: "budget", allow: true },
            { viewer: "gm", path: "timeline", allow: true },
            { viewer: "gm", path: "runtime/*", allow: true },
          ],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    setState({
      ...k.timeline.state(),
      scene: {
        id: "scn_1",
        location: "loc",
        participants: ["npc1", "player"],
        turn: 2,
        startedAt: { day: 1, minute: 0 },
        fields: [],
      },
      beat: { current: "beat1", entered: ["beat1"] },
    });
    const intro = createIntrospect(k);
    expect(intro.query("gm", "world/time")).toMatchObject({ day: 1 });
    expect(intro.query("gm", "world/location")).toBeDefined();
    expect(intro.query("gm", "world/chapter")).toBeDefined();
    expect(intro.query("gm", "world/fields")).toEqual([]);
    expect(intro.query("gm", "scene")).toMatchObject({ id: "scn_1", turn: 2 });
    expect(intro.query("gm", "director/anchors")).toBeDefined();
    expect(intro.query("gm", "director/beat")).toMatchObject({ current: "beat1" });
    expect(intro.query("gm", "budget")).toBeDefined();
    expect(intro.query("gm", "timeline")).toMatchObject({ branch: { name: "main" } });
    expect(intro.query("gm", "runtime/mode")).toBeDefined();
  });

  test("unknown path returns undefined", () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "gm", path: "world/*", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    expect(intro.query("gm", "not/a/real/path")).toBeUndefined();
  });

  test("query catch-up entity mapping for player", () => {
    expect(entityRefForQueryCatchUp("player", "characters/npc1/tracks")).toEqual({ kind: "character", id: "npc1" });
    expect(entityRefForQueryCatchUp("player", "world/locations/tavern")).toEqual({ kind: "location", id: "tavern" });
    expect(entityRefForQueryCatchUp("gm", "characters/npc1/tracks")).toBeNull();
  });
});
