import { describe, expect, test } from "bun:test";
import { compactRelationLine } from "../../src/pipeline/relation-line.ts";
import type { Policy } from "../../src/schema/policy.ts";
import { createPipelineKernel, charDef } from "./test-kernel.ts";

const tracks: NonNullable<Policy["tracks"]> = {
  rapport: {
    scope: "relation",
    label: "Rapport",
    min: 0,
    max: 100,
    initial: 40,
    hysteresis: 0,
    tiers: [
      { name: "cold", from: 0 },
      { name: "wary", from: 25 },
      { name: "easy", from: 45 },
      { name: "warm", from: 65 },
    ],
  },
  ties: {
    scope: "relation",
    label: "Ties",
    min: 0,
    max: 100,
    initial: 10,
    hysteresis: 0,
    tiers: [
      { name: "strangers", from: 0 },
      { name: "friends", from: 40 },
      { name: "close", from: 70 },
    ],
  },
  heat: {
    scope: "relation",
    label: "Heat",
    min: 0,
    max: 100,
    initial: 5,
    hysteresis: 0,
    tiers: [
      { name: "cool", from: 0 },
      { name: "warming", from: 30 },
      { name: "hot", from: 60 },
    ],
  },
  mood: { scope: "self", min: 0, max: 100, initial: 50, hysteresis: 0, tiers: [{ name: "flat", from: 0 }] },
};

const directives = {
  rapport: { cold: "Keep it curt.", wary: "Answer, but hedge.", easy: "Chat normally.", warm: "Share freely." },
  ties: { strangers: "Stay formal.", friends: "Joke around.", close: "Lean in." },
  heat: { cool: "No innuendo.", warming: "Allow teasing.", hot: "Flirt openly." },
};

type RelationDisplay = NonNullable<NonNullable<Policy["render"]>["relation"]>;

function setup(toward: Record<string, string>, relation?: RelationDisplay) {
  const { k, setState } = createPipelineKernel({
    chars: [charDef("mira"), charDef("player")],
    policy: {
      tracks,
      x: { tier_directives: directives },
      ...(relation ? { render: { retryOnMismatch: 0, recentTurns: 12, relation } } : {}),
    },
  });
  setState({
    ...k.timeline.state(),
    characters: {
      ...k.timeline.state().characters,
      mira: { ...k.timeline.state().characters.mira!, tiers: { self: {}, toward: { player: toward } } },
    },
  });
  return k;
}

describe("compactRelationLine", () => {
  test("leaves out the tier a track starts in and shows the ones that moved, using labels not ids", () => {
    const line = compactRelationLine(setup({ rapport: "warm", ties: "strangers", heat: "cool" }), "mira", "player");
    expect(line).toContain("Rapport Warm");
    expect(line).not.toContain("Strangers");
    expect(line).not.toContain("Heat");
    expect(line).not.toContain("rapport");
    expect(line).not.toMatch(/\bwarm\b/);
  });

  test("shows no tier list at all when every track is still at its starting tier", () => {
    const line = compactRelationLine(setup({ rapport: "wary", ties: "strangers", heat: "cool" }), "mira", "player");
    expect(line).not.toContain(": ");
    expect(line).not.toContain("Rapport");
  });

  test("render.relation.silentTiers overrides the baseline default", () => {
    const k = setup({ rapport: "wary", ties: "strangers", heat: "cool" }, { silentTiers: { rapport: [], ties: ["strangers"] } });
    const line = compactRelationLine(k, "mira", "player");
    expect(line).toContain("Rapport Wary");
    expect(line).not.toContain("Ties");
  });

  test("render.relation.tracks sets the order and maxTracks caps the list", () => {
    const k = setup(
      { rapport: "warm", ties: "close", heat: "hot" },
      { tracks: ["heat", "ties", "rapport"], maxTracks: 2 },
    );
    const line = compactRelationLine(k, "mira", "player");
    expect(line.indexOf("Heat Hot")).toBeGreaterThan(-1);
    expect(line.indexOf("Heat Hot")).toBeLessThan(line.indexOf("Ties Close"));
    expect(line).not.toContain("Rapport");
  });

  test("the directive comes from the track that moved furthest from its start; fresh relations use the configured order", () => {
    const fresh = compactRelationLine(setup({ rapport: "wary", ties: "strangers", heat: "cool" }), "mira", "player");
    expect(fresh).toContain("Answer, but hedge");
    expect(fresh).not.toContain("Stay formal");

    const moved = compactRelationLine(setup({ rapport: "wary", ties: "strangers", heat: "hot" }), "mira", "player");
    expect(moved).toContain("Flirt openly");
    expect(moved).not.toContain("Answer, but hedge");
  });

  test("maxDirectives joins several directives, strongest first", () => {
    const k = setup(
      { rapport: "wary", ties: "close", heat: "warming" },
      { maxDirectives: 2 },
    );
    const line = compactRelationLine(k, "mira", "player");
    expect(line.indexOf("Lean in")).toBeGreaterThan(-1);
    expect(line.indexOf("Lean in")).toBeLessThan(line.indexOf("Allow teasing"));
    expect(line).not.toContain("Answer, but hedge");
  });

  test("never emits punctuation clashes or untranslated ids", () => {
    const line = compactRelationLine(setup({ rapport: "warm", ties: "friends", heat: "warming" }), "mira", "player");
    expect(line).not.toMatch(/;;|\.;|:\s*$/);
    expect(line).not.toContain("$t:");
  });
});
