import { test, expect, describe } from "bun:test";
import { abilityModifier, proficiencyBonus, skillModifier } from "../src/math.ts";
import { conditionField } from "../src/conditions.ts";
import { rest, REST_DURATIONS } from "../src/rest.ts";
import { dndIntimidationExtra } from "../src/rules.ts";
import { createCelEngine } from "../../engine/src/rules/cel.ts";
import { createRuleEngine } from "../../engine/src/rules/rule-engine.ts";
import { runChecks } from "../../engine/src/rules/checks.ts";
import { createRng } from "../../engine/src/timeline/rng.ts";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPresetBundleObject } from "../scripts/gen-bundle.ts";
import { generatedBundle } from "../src/generated.ts";
import { notice } from "../src/notice.ts";
import { stableStringify } from "../../engine/src/store/util.ts";
import { loadDndPolicy } from "../../preset-base/test/helpers.ts";
import { authoredStub, baseState, catalog, npcDef } from "../../preset-base/test/helpers.ts";
import { createTranslator, localizeDeep } from "../../i18n/src/index.ts";

test("generated.ts matches YAML", async () => {
  expect(stableStringify(await buildPresetBundleObject())).toBe(stableStringify(generatedBundle));
});

test("skill check info_arrival copy localizes via preset displayStrings", () => {
  const dndPolicy = generatedBundle.policies.find((p) => p.name === "policies/dnd.yaml")?.doc as {
    checks?: { id: string; onSuccess?: { emit?: { text?: unknown }[] } }[];
  };
  const insight = dndPolicy?.checks?.find((c) => c.id === "dnd_insight");
  const textRef = insight?.onSuccess?.emit?.[0]?.text;
  expect(textRef).toEqual({ i18n: { key: "dnd.check.insight_lie" } });

  const tables = generatedBundle.displayStrings;
  expect(tables?.en).toBeDefined();
  expect(tables?.fr).toBeDefined();
  const en = createTranslator({
    locale: "en",
    catalogs: { strings: { en: tables!.en! } },
    defaultNamespace: "strings",
  });
  const fr = createTranslator({
    locale: "fr",
    catalogs: { strings: { fr: tables!.fr! } },
    defaultNamespace: "strings",
  });
  expect(localizeDeep({ text: textRef }, en.t.bind(en))).toEqual({ text: "They seem to be lying." });
  expect(localizeDeep({ text: textRef }, fr.t.bind(fr))).toEqual({ text: "Ils ou elles mentent." });
});

test("SRD notice shipped in README, NOTICE, and export", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const shipped = readFileSync(join(root, "NOTICE"), "utf8").trim();
  expect(shipped).toBe(notice);
  expect(notice).toContain("SRD 5.2.1");
});

describe("ability modifier and proficiency", () => {
  test("modifier table including negatives", () => {
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(9)).toBe(-1);
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
    expect(abilityModifier(12)).toBe(1);
  });

  test("proficiency by level boundaries", () => {
    expect(proficiencyBonus(1)).toBe(2);
    expect(proficiencyBonus(4)).toBe(2);
    expect(proficiencyBonus(5)).toBe(3);
    expect(proficiencyBonus(8)).toBe(3);
    expect(proficiencyBonus(9)).toBe(4);
    expect(proficiencyBonus(20)).toBe(6);
  });

  test("skillModifier sums ability and proficiency", () => {
    expect(skillModifier("persuasion", { CHA: 16 }, 5, ["persuasion"])).toBe(3 + 3);
  });
});

describe("checks and outcomes", () => {
  function playerTraits() {
    return {
      abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 14, CHA: 16 },
      level: 5,
      proficiencies: ["persuasion", "deception", "intimidation", "insight", "investigation", "perception"],
    };
  }

  function npcTraits() {
    return {
      abilities: { STR: 10, DEX: 10, CON: 10, INT: 12, WIS: 10, CHA: 10 },
      level: 3,
      proficiencies: ["deception"],
    };
  }

  function depsFor(state = baseState()) {
    state.characters.player = {
      id: "player",
      name: "Player",
      lod: "principal",
      origin: "authored",
      tracks: { self: {}, toward: {} },
      tiers: { self: {}, toward: {} },
      vars: {},
      tags: [],
      goals: [],
      claims: [],
      interactions: 0,
      unlockedSecrets: [],
      lastSimulated: { day: 1, minute: 0 },
    };
    const def = npcDef({ traits: { event_mult: {}, ...npcTraits() } as never });
    return {
      state,
      authored: authoredStub,
      policy: null as unknown as Awaited<ReturnType<typeof loadDndPolicy>>,
      cel: createCelEngine(),
      rules: createRuleEngine(createCelEngine()),
      catalog: {
        ...catalog(def),
        character(id: string) {
          if (id === "player") {
            return {
              ...def,
              id: "player",
              traits: { event_mult: {}, ...playerTraits() },
            };
          }
          return catalog(def).character(id);
        },
      },
      celContext: {},
    };
  }

  test("DC is max(15, NPC INT score)", async () => {
    const policy = await loadDndPolicy();
    const cel = createCelEngine();
    const ctx = {
      self: { traits: npcTraits() },
    };
    expect(cel.num("maxInt(15, self.traits.abilities.INT)", ctx)).toBe(15);
    expect(cel.num("maxInt(15, self.traits.abilities.INT)", { self: { traits: { abilities: { INT: 18 } } } })).toBe(18);
  });

  test("advantage/disadvantage by affinity tier in policy CEL", async () => {
    const cel = createCelEngine();
    expect(cel.bool('tiers.affinity in ["distant", "cool"]', { tiers: { affinity: "distant" } })).toBe(true);
    expect(cel.bool('tiers.affinity in ["close", "devoted"]', { tiers: { affinity: "devoted" } })).toBe(true);
  });

  test("persuasion failure retypes to smalltalk", async () => {
    const policy = await loadDndPolicy();
    let seed = 0;
    let out;
    for (; seed < 500; seed++) {
      const deps = depsFor();
      deps.policy = policy;
      out = runChecks(deps, {
        appraisal: { type: "care", intensity: 1, sincerity: 1, approach: "persuasion", claims: [], search_terms: [], tags: [], input_class: "normal" },
        actor: "player",
        owner: "npc",
        turnId: "turn_1",
        rng: createRng(seed, "main", "check"),
      });
      if (!out.result?.success) break;
    }
    expect(out!.result?.success).toBe(false);
    expect(out!.appraisal.type).toBe("smalltalk");
  });

  test("deception success adds deceived tag; failure retypes", async () => {
    const policy = await loadDndPolicy();
    let successOut;
    let failOut;
    for (let seed = 0; seed < 500; seed++) {
      const deps = depsFor();
      deps.policy = policy;
      const out = runChecks(deps, {
        appraisal: { type: "care", intensity: 1, sincerity: 1, approach: "deception", claims: [], search_terms: [], tags: [], input_class: "normal" },
        actor: "player",
        owner: "npc",
        turnId: "turn_1",
        rng: createRng(seed, "main", "check"),
      });
      if (out.result?.success) successOut = out;
      else failOut = out;
      if (successOut && failOut) break;
    }
    expect(successOut!.appraisal.tags).toContain("deceived");
    expect(failOut!.appraisal.type).toBe("insincere_speech");
  });

  test("insight contest DC 8 + NPC deception mod", async () => {
    const policy = await loadDndPolicy();
    const cel = createCelEngine();
    const ctx = { self: { traits: npcTraits() } };
    const dc = cel.num('8 + abilityMod(self.traits.abilities.CHA) + ("deception" in self.traits.proficiencies ? profBonus(self.traits.level) : 0)', ctx);
    expect(dc).toBe(8 + 0 + 2);
  });

  test("intimidation success emits extra track deltas via rule fn", () => {
    const state = baseState();
    const drafts = dndIntimidationExtra({
      stage: "adjudicate",
      state,
      authored: authoredStub,
      policy: {} as never,
      time: state.time,
      vars: {
        self: { id: "npc" },
        actor: { id: "player" },
        event: { type: "care", approach: "intimidation" },
        check: { success: true },
      } as never,
      rng: () => 0,
    });
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.kind === "track.delta" && (d as unknown as { delta: number }).delta === -2)).toBe(true);
  });
});

test("exhaustion field applies −2 per level via check_mod bonus", () => {
  const f = conditionField("exhaustion", { level: 3, subject: "player" });
  expect(f.effects.check_mod?.["*"]?.bonus).toBe(-6);
});

test("rest helpers advance world time and reduce exhaustion", async () => {
  const advances: number[] = [];
  const revoked: string[] = [];
  const granted: string[] = [];
  const engine = {
    world: { advance: async (m: number) => { advances.push(m); return []; } },
    fields: {
      revoke: (id: string) => { revoked.push(id); },
      grant: (f: { id: string }) => { granted.push(f.id); },
    },
    listFieldIds: () => ["dnd-exhaustion-2"],
  };
  await rest(engine, "short");
  expect(advances).toEqual([REST_DURATIONS.short]);
  await rest(engine, "long");
  expect(advances[1]).toBe(REST_DURATIONS.long);
  expect(revoked).toContain("dnd-exhaustion-2");
  expect(granted).toContain("dnd-exhaustion-1");
});
