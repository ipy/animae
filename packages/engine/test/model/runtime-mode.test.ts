import { describe, expect, test } from "bun:test";
import { availabilityOf, modelsInfoOf, resolveInitialMode } from "../../src/model/mode.ts";
import { AnimaeError } from "../../src/types.ts";
import type { ResolvedModels } from "../../src/model/config.ts";
import { RULE_MODEL_ID } from "../../src/model/rule-port.ts";
import { createTierResolver } from "../../src/model/tier-resolver.ts";
import type { ModelPort } from "../../src/ports.ts";

describe("resolveInitialMode", () => {
  test("mode presets and object overrides adjust backends", () => {
    const avail = { s1: true, s2: true };
    expect(resolveInitialMode({ seed: 1, policies: [], mode: "rule" }, avail).appraise).toBe("rule");
    expect(resolveInitialMode({ seed: 1, policies: [], mode: "llm" }, avail).render).toBe("llm");
    expect(resolveInitialMode({ seed: 1, policies: [], appraise: { backend: "rule" } }, avail).appraise).toBe("rule");
    const preset = resolveInitialMode({ seed: 1, policies: [] }, avail, "judge-only");
    expect(preset.appraise).toBe("llm");
    expect(preset.render).toBe("rule");
    const custom = resolveInitialMode({ seed: 1, policies: [] }, avail, { render: "llm", s2Tier: "fast" });
    expect(custom.s2Tier).toBe("fast");
  });

  test("unknown preset throws MODE_INVALID", () => {
    expect(() => resolveInitialMode({ seed: 1, policies: [] }, { s1: true, s2: true }, "bogus" as "rule")).toThrow(AnimaeError);
  });

  test("llm backend without model throws MODEL_CONFIG", () => {
    expect(() => resolveInitialMode({ seed: 1, policies: [], mode: "llm" }, { s1: false, s2: true })).toThrow(AnimaeError);
    expect(() =>
      resolveInitialMode({ seed: 1, policies: [], render: { backend: "llm" } }, { s1: true, s2: false }),
    ).toThrow(AnimaeError);
  });
});

describe("modelsInfoOf", () => {
  test("reports tier routing metadata", () => {
    const s2 = {
      id: "tier/fast",
      object: async <T>() => ({}) as T,
      stream: async function* () {},
      usage: () => ({ inputTokens: 0, outputTokens: 0 }),
    } as ModelPort;
    const tiers = createTierResolver([{ id: "fast", port: s2 }, { id: "quality", port: s2 }], {
      default: "fast",
      routing: { render: "fast", escalate_to: "quality" },
    });
    const models = { s1: s2, s2, tiers, llm: { s1: true, s2: true } } as ResolvedModels;
    expect(availabilityOf(models)).toEqual({ s1: true, s2: true });
    const info = modelsInfoOf(models);
    expect(info.s1).toBe("tier/fast");
    expect(info.s2Default).toBe("fast");
    expect(info.s2Escalate).toBe("quality");
    expect(modelsInfoOf({ s2, tiers: undefined, llm: { s1: false, s2: true } } as ResolvedModels).s1).toBe(RULE_MODEL_ID);
  });
});
