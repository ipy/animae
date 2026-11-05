import { describe, expect, test } from "bun:test";
import { buildExplanation } from "../../src/introspect/explain.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
async function appendTurnEvent(k: ReturnType<typeof createFakeKernel>["k"], draft: Record<string, unknown>) {
  const { kind, ...rest } = draft;
  await k.timeline.append([{ kind: kind as string, ...rest, source: "test" }], { turn: "turn_1", scene: "scn_1" });
}

describe("buildExplanation oneLine summaries", () => {
  test("formats route, runtime, budget, and check events for debug viewer", async () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "debug", path: "events", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    await appendTurnEvent(k, { kind: "input.received", actor: "player", text: "Hello there friend" });
    await appendTurnEvent(k, { kind: "check.rolled", expr: "1d20", total: 15, dc: 12, success: true });
    await appendTurnEvent(k, { kind: "track.delta", track: "mood", delta: 3, before: 40, after: 43 });
    await appendTurnEvent(k, {
      kind: "route.decided",
      appraise: { backend: "llm" },
      render: { backend: "llm", tier: "fast" },
      triggers: ["mood_spike"],
      escalated: true,
    });
    await appendTurnEvent(k, {
      kind: "runtime.mode_changed",
      before: { appraise: "rule", render: "rule" },
      after: { appraise: "llm", render: "llm", s2Tier: "fast" },
      reason: "user",
    });
    await appendTurnEvent(k, {
      kind: "runtime.fallback_used",
      phase: "render",
      from: "llm",
      to: "rule",
      error: { code: "MODEL_TIMEOUT" },
    });
    await appendTurnEvent(k, { kind: "budget.degraded", action: "drop_s2", from: "fast", to: "rule" });
    await appendTurnEvent(k, { kind: "narration", style: "normal", text: "Rain falls." });

    const ex = buildExplanation(k, "turn_1", "debug");
    const summaries = ex.chain.map((c) => c.summary);
    expect(summaries.some((s) => s.includes("Input from player"))).toBe(true);
    expect(summaries.some((s) => s.includes("Check 1d20"))).toBe(true);
    expect(summaries.some((s) => s.includes("Track mood +3"))).toBe(true);
    expect(summaries.some((s) => s.includes("escalated") && s.includes("mood_spike"))).toBe(true);
    expect(summaries.some((s) => s.includes("Mode S1:rule"))).toBe(true);
    expect(summaries.some((s) => s.includes("Fallback render"))).toBe(true);
    expect(summaries.some((s) => s.includes("Budget degraded"))).toBe(true);
    expect(ex.chain.every((c) => c.data !== undefined)).toBe(true);
  });

  test("retrieval hits attach to utterance with visibility-safe data", async () => {
    const { k, setState } = createFakeKernel({
      policy: {
        visibility: {
          rules: [
            { viewer: "player", path: "events", allow: true },
            { viewer: "player", path: "characters/npc1/memory", allow: true },
          ],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    await k.m.memory.write("npc1", {
      kind: "episodic",
      t: { day: 1, minute: 0 },
      text: "secret memory body",
      tags: [],
      claims: [],
      importance: 0.5,
      valence: 0,
    });
    const memId = (await k.m.memory.list("npc1"))[0]!.id;
    await appendTurnEvent(k, {
      kind: "utterance",
      retrieval: [{ kind: "memory", id: memId, score: 0.42, owner: "npc1" }],
    });
    const ex = buildExplanation(k, "turn_1", "player");
    const hit = ex.chain.find((c) => c.kind === "retrieval");
    expect(hit?.summary).toContain("memory");
    expect((hit?.data as { text?: string })?.text).toBe("secret memory body");
  });
});
