import { describe, expect, test } from "bun:test";
import { secretUnlockDrafts } from "../../src/rules/secrets.ts";
import { AnimaeError } from "../../src/types.ts";
import { createPipelineKernel, charDef } from "../pipeline/test-kernel.ts";
import { SecretSchema, type CharacterDef } from "../../src/schema/authored.ts";
import type { EngineState } from "../../src/state.ts";

const trustPolicy = {
  tracks: {
    trust: { scope: "relation" as const, min: 0, max: 100, initial: 40, tiers: [], hysteresis: 0 },
    mood: { scope: "self" as const, min: 0, max: 100, initial: 50, tiers: [], hysteresis: 0 },
  },
  events: { types: { chat: { positive: false } } },
};

function npcSecrets(extra?: Partial<CharacterDef>): CharacterDef {
  return {
    ...charDef("npc1"),
    secrets: [
      { id: "low", text: "Low gate", tags: ["low"], unlock: "tracks.trust >= 50" },
      { id: "high", text: "High gate", tags: ["high"], unlock: "tracks.trust >= 80" },
      { id: "fixed_false", text: "Never", tags: ["never"], unlock: "false" },
    ],
    ...extra,
  };
}

function setTrustToward(
  setState: (s: EngineState) => void,
  k: ReturnType<typeof createPipelineKernel>["k"],
  toward: Record<string, { trust: number }>,
) {
  const st = k.timeline.state();
  const npc = st.characters.npc1!;
  setState({
    ...st,
    characters: {
      ...st.characters,
      npc1: {
        ...npc,
        unlockedSecrets: [...npc.unlockedSecrets],
        tracks: {
          ...npc.tracks,
          toward: Object.fromEntries(
            Object.entries(toward).map(([id, tr]) => [
              id,
              { ...(npc.tracks.toward[id] ?? {}), trust: tr.trust },
            ]),
          ),
        },
      },
    },
  });
}

describe("secretUnlockDrafts", () => {
  test("default unlock false never emits drafts", () => {
    const { k, setState } = createPipelineKernel({
      policy: trustPolicy,
      chars: [
        {
          ...charDef("npc1"),
          secrets: [{ id: "only", text: "x", tags: ["t"], unlock: "false" }],
        },
        charDef("player", "supporting"),
      ],
    });
    setTrustToward(setState, k, { player: { trust: 99 } });
    expect(secretUnlockDrafts(k, "npc1", "player", "scn_1")).toEqual([]);
  });

  test("authored secret with no unlock field stays locked (schema default false)", () => {
    const parsed = SecretSchema.parse({ id: "bare", text: "hidden", tags: ["t"] });
    const { k, setState } = createPipelineKernel({
      policy: trustPolicy,
      chars: [{ ...charDef("npc1"), secrets: [parsed] }, charDef("player", "supporting")],
    });
    setTrustToward(setState, k, { player: { trust: 99 } });
    expect(secretUnlockDrafts(k, "npc1", "player")).toEqual([]);
  });

  test("false expression stays locked", () => {
    const { k, setState } = createPipelineKernel({ policy: trustPolicy, chars: [npcSecrets(), charDef("player", "supporting")] });
    setTrustToward(setState, k, { player: { trust: 45 } });
    expect(secretUnlockDrafts(k, "npc1", "player")).toEqual([]);
  });

  test("true expression emits one draft with id, secret, and source", () => {
    const { k, setState } = createPipelineKernel({ policy: trustPolicy, chars: [npcSecrets(), charDef("player", "supporting")] });
    setTrustToward(setState, k, { player: { trust: 55 } });
    const drafts = secretUnlockDrafts(k, "npc1", "player", "scn_1");
    expect(drafts).toEqual([
      { kind: "character.secret_unlocked", source: "rules:secrets", character: "npc1", secret: "low" },
    ]);
  });

  test("skips already unlocked secrets", () => {
    const { k, setState } = createPipelineKernel({ policy: trustPolicy, chars: [npcSecrets(), charDef("player", "supporting")] });
    setTrustToward(setState, k, { player: { trust: 85 } });
    const st = k.timeline.state();
    setState({
      ...st,
      characters: {
        ...st.characters,
        npc1: { ...st.characters.npc1!, unlockedSecrets: ["low"] },
      },
    });
    const drafts = secretUnlockDrafts(k, "npc1", "player");
    expect(drafts).toEqual([
      { kind: "character.secret_unlocked", source: "rules:secrets", character: "npc1", secret: "high" },
    ]);
  });

  test("mixed thresholds unlock only those that pass", () => {
    const { k, setState } = createPipelineKernel({ policy: trustPolicy, chars: [npcSecrets(), charDef("player", "supporting")] });
    setTrustToward(setState, k, { player: { trust: 60 } });
    const drafts = secretUnlockDrafts(k, "npc1", "player");
    expect(
      drafts.flatMap((d) => ("secret" in d && typeof d.secret === "string" ? [d.secret] : [])),
    ).toEqual(["low"]);
  });

  test("unknown character or no secrets returns empty", () => {
    const { k, setState } = createPipelineKernel({
      policy: trustPolicy,
      chars: [{ ...charDef("npc1"), secrets: [] }, charDef("player", "supporting")],
    });
    setTrustToward(setState, k, { player: { trust: 90 } });
    expect(secretUnlockDrafts(k, "npc1", "player")).toEqual([]);
    expect(secretUnlockDrafts(k, "missing", "player")).toEqual([]);
  });

  test("tracks trust is owner toward other, not toward a third party", () => {
    const { k, setState } = createPipelineKernel({
      policy: trustPolicy,
      chars: [npcSecrets(), charDef("player", "supporting"), charDef("npc2")],
    });
    setTrustToward(setState, k, { player: { trust: 55 }, npc2: { trust: 30 } });
    expect(secretUnlockDrafts(k, "npc1", "player").length).toBe(1);
    expect(secretUnlockDrafts(k, "npc1", "npc2")).toEqual([]);
  });

  test("runtime CEL evaluation error propagates", () => {
    const { k, setState } = createPipelineKernel({
      policy: trustPolicy,
      chars: [
        {
          ...charDef("npc1"),
          secrets: [{ id: "bad", text: "x", tags: [], unlock: "world.vars['missing'] == true" }],
        },
        charDef("player", "supporting"),
      ],
    });
    setTrustToward(setState, k, { player: { trust: 50 } });
    expect(() => secretUnlockDrafts(k, "npc1", "player")).toThrow(AnimaeError);
    try {
      secretUnlockDrafts(k, "npc1", "player");
    } catch (e) {
      expect((e as AnimaeError).code).toBe("CEL_EVAL");
    }
  });
});
