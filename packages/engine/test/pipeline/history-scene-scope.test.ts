import { describe, expect, test } from "bun:test";
import { buildRecentHistory } from "../../src/pipeline/history.ts";
import { createPipelineKernel, charDef } from "./test-kernel.ts";

const ALICE_LINE = "alice-only-secret-line";
const BOB_LINE = "bob-only-secret-line";
const SAFEWORD = "player-safeword-marker";
const NO_SCENE = "global-no-scene-line";

describe("history scene participation scope", () => {
  test("scene B with bob excludes scene A lines with alice and player safeword", async () => {
    const { k } = createPipelineKernel({
      chars: [charDef("alice"), charDef("bob"), charDef("player")],
    });
    await k.timeline.append([
      { kind: "scene.started", sceneId: "scn_a", location: "tavern", participants: ["player", "alice"], fields: [], source: "test" },
      { kind: "input.received", scene: "scn_a", turn: "turn_1", actor: "player", text: SAFEWORD, source: "test" },
      { kind: "utterance", scene: "scn_a", turn: "turn_1", speaker: "alice", text: ALICE_LINE, source: "test" },
      { kind: "scene.ended", sceneId: "scn_a", source: "test" },
      { kind: "scene.started", sceneId: "scn_b", location: "market", participants: ["player", "bob"], fields: [], source: "test" },
    ] as never);

    const history = buildRecentHistory(k, "bob", "player", 12, {
      sceneId: "scn_b",
      participants: ["player", "bob"],
    });
    const blob = history.map((h) => h.content).join("\n");
    expect(blob).not.toContain(ALICE_LINE);
    expect(blob).not.toContain(SAFEWORD);
  });

  test("alice in a later scene still sees scene A dialogue she attended", async () => {
    const { k } = createPipelineKernel({
      chars: [charDef("alice"), charDef("bob"), charDef("player")],
    });
    await k.timeline.append([
      { kind: "scene.started", sceneId: "scn_a", location: "tavern", participants: ["player", "alice"], fields: [], source: "test" },
      { kind: "utterance", scene: "scn_a", turn: "turn_1", speaker: "alice", text: ALICE_LINE, source: "test" },
      { kind: "scene.ended", sceneId: "scn_a", source: "test" },
      { kind: "scene.started", sceneId: "scn_c", location: "hall", participants: ["player", "alice", "bob"], fields: [], source: "test" },
    ] as never);

    const history = buildRecentHistory(k, "alice", "player", 12, {
      sceneId: "scn_c",
      participants: ["player", "alice", "bob"],
    });
    expect(history.some((h) => h.content.includes(ALICE_LINE))).toBe(true);
  });

  test("active scene lines are visible", async () => {
    const { k } = createPipelineKernel({ chars: [charDef("bob"), charDef("player")] });
    await k.timeline.append([
      { kind: "scene.started", sceneId: "scn_b", location: "market", participants: ["player", "bob"], fields: [], source: "test" },
      { kind: "utterance", scene: "scn_b", turn: "turn_2", speaker: "bob", text: BOB_LINE, source: "test" },
    ] as never);

    const history = buildRecentHistory(k, "bob", "player", 12, {
      sceneId: "scn_b",
      participants: ["player", "bob"],
    });
    expect(history.map((h) => h.content)).toContain(BOB_LINE);
  });

  test("no-scene lines remain visible", async () => {
    const { k } = createPipelineKernel({ chars: [charDef("bob"), charDef("player")] });
    await k.timeline.append([
      { kind: "input.received", turn: "turn_0", actor: "player", text: NO_SCENE, source: "test" },
      { kind: "scene.started", sceneId: "scn_b", location: "market", participants: ["player", "bob"], fields: [], source: "test" },
    ] as never);

    const history = buildRecentHistory(k, "bob", "player", 12, {
      sceneId: "scn_b",
      participants: ["player", "bob"],
    });
    expect(history.map((h) => h.content)).toContain(NO_SCENE);
  });

  test("K window counts only visible turns", async () => {
    const { k } = createPipelineKernel({
      chars: [charDef("alice"), charDef("bob"), charDef("player")],
    });
    await k.timeline.append([
      { kind: "scene.started", sceneId: "scn_a", location: "tavern", participants: ["player", "alice"], fields: [], source: "test" },
      { kind: "input.received", scene: "scn_a", turn: "turn_1", actor: "player", text: "t1", source: "test" },
      { kind: "input.received", scene: "scn_a", turn: "turn_2", actor: "player", text: "t2", source: "test" },
      { kind: "input.received", scene: "scn_a", turn: "turn_3", actor: "player", text: "t3", source: "test" },
      { kind: "scene.ended", sceneId: "scn_a", source: "test" },
      { kind: "scene.started", sceneId: "scn_b", location: "market", participants: ["player", "bob"], fields: [], source: "test" },
      { kind: "input.received", scene: "scn_b", turn: "turn_4", actor: "player", text: "t4", source: "test" },
      { kind: "input.received", scene: "scn_b", turn: "turn_5", actor: "player", text: "t5", source: "test" },
    ] as never);

    const history = buildRecentHistory(k, "bob", "player", 2, {
      sceneId: "scn_b",
      participants: ["player", "bob"],
    });
    const turns = [...new Set(history.map((h) => h.turnId))];
    expect(turns).toEqual(["turn_4", "turn_5"]);
  });

  test("explicit scope after scene end keeps ended scene visible for reflection", async () => {
    const { k } = createPipelineKernel({ chars: [charDef("alice"), charDef("player")] });
    await k.timeline.append([
      { kind: "scene.started", sceneId: "scn_a", location: "tavern", participants: ["player", "alice"], fields: [], source: "test" },
      { kind: "utterance", scene: "scn_a", turn: "turn_1", speaker: "alice", text: ALICE_LINE, source: "test" },
      { kind: "scene.ended", sceneId: "scn_a", source: "test" },
    ] as never);

    const history = buildRecentHistory(k, "alice", "player", 12, {
      sceneId: "scn_a",
      participants: ["player", "alice"],
    });
    expect(history.map((h) => h.content)).toContain(ALICE_LINE);
  });
});
