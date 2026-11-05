import { describe, expect, test } from "bun:test";
import type { ModelsInfo } from "@animae/engine";
import { formatMode, modeAvailable, modeIndicator, modePanelRows } from "../src/utils/mode-display.ts";

const tiers: ModelsInfo = {
  s1: "judge/small",
  s2: "writer/std",
  s1Llm: true,
  s2Tiers: [
    { id: "std", model: "writer/std", tags: ["cheap"] },
    { id: "pro", model: "writer/pro", tags: ["strong"] },
  ],
  s2Default: "std",
  s2Escalate: "pro",
};
const single: ModelsInfo = { ...tiers, s2Tiers: [{ id: "only", model: "writer/std", tags: [] }], s2Default: "only" };
const none: ModelsInfo = { s1: "rule", s2: "rule", s1Llm: false, s2Tiers: [] };

describe("mode indicator", () => {
  test("shows each role's backend, and the S2 tier when the engine has named tiers", () => {
    expect(modeIndicator({ appraise: "llm", render: "llm" }, tiers)).toBe("[S1:LLM S2:std]");
    expect(modeIndicator({ appraise: "llm", render: "llm", s2Tier: "pro" }, tiers)).toBe("[S1:LLM S2:pro]");
    expect(modeIndicator({ appraise: "llm", render: "rule" }, tiers)).toBe("[S1:LLM S2:RULE]");
    expect(modeIndicator({ appraise: "rule", render: "llm" }, tiers)).toBe("[S1:RULE S2:std]");
  });

  test("both roles on rules collapse to [RULE]", () => {
    expect(modeIndicator({ appraise: "rule", render: "rule" }, none)).toBe("[RULE]");
    expect(modeIndicator({ appraise: "rule", render: "rule", s2Tier: "pro" }, tiers)).toBe("[RULE]");
  });

  test("a single unnamed model is just LLM", () => {
    expect(modeIndicator({ appraise: "llm", render: "llm" }, single)).toBe("[S1:LLM S2:LLM]");
  });

  test("a change that waits for the turn boundary is appended", () => {
    expect(modeIndicator({ appraise: "llm", render: "llm" }, tiers, { appraise: "rule", render: "rule" })).toBe(
      "[S1:LLM S2:std] → [RULE]",
    );
    expect(formatMode({ appraise: "llm", render: "rule" }, tiers)).toBe("S1:LLM S2:RULE");
  });
});

describe("mode availability", () => {
  test("a role on llm needs a model", () => {
    expect(modeAvailable({ appraise: "llm", render: "llm" }, none)).toBe(false);
    expect(modeAvailable({ appraise: "llm", render: "rule" }, none)).toBe(false);
    expect(modeAvailable({ appraise: "rule", render: "llm" }, none)).toBe(false);
    expect(modeAvailable({ appraise: "rule", render: "rule" }, none)).toBe(true);
    expect(modeAvailable({ appraise: "llm", render: "llm" }, tiers)).toBe(true);
  });
});

describe("mode panel rows", () => {
  test("the four presets in order, the current one marked", () => {
    const rows = modePanelRows({ appraise: "llm", render: "rule" }, single);
    expect(rows.map((r) => [r.id, r.current, r.available])).toEqual([
      ["preset:full", false, true],
      ["preset:judge-only", true, true],
      ["preset:narrate-only", false, true],
      ["preset:rule", false, true],
    ]);
  });

  test("presets that need a missing model are unavailable", () => {
    const rows = modePanelRows({ appraise: "rule", render: "rule" }, none);
    expect(rows.filter((r) => r.available).map((r) => r.id)).toEqual(["preset:rule"]);
  });

  test("tiers are listed only with more than one, and apply while S2 runs on a model", () => {
    const llm = modePanelRows({ appraise: "llm", render: "llm", s2Tier: "pro" }, tiers);
    expect(llm.filter((r) => r.kind === "tier").map((r) => [r.id, r.current, r.available])).toEqual([
      ["tier:std", false, true],
      ["tier:pro", true, true],
    ]);
    const rule = modePanelRows({ appraise: "llm", render: "rule" }, tiers);
    expect(rule.filter((r) => r.kind === "tier").every((r) => !r.available && !r.current)).toBe(true);
    expect(modePanelRows({ appraise: "llm", render: "llm" }, single).some((r) => r.kind === "tier")).toBe(false);
  });
});
