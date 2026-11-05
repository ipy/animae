import { describe, expect, test } from "bun:test";
import { buildExplanation } from "../../src/introspect/explain.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
import { testKnowledgeDoc } from "../helpers/knowledge-doc.ts";

async function appendTurnEvent(k: ReturnType<typeof createFakeKernel>["k"], draft: Record<string, unknown>) {
  const { kind, ...rest } = draft;
  await k.timeline.append([{ kind: kind as string, ...rest, source: "test" }], { turn: "turn_1", scene: "scn_1" });
}

describe("buildExplanation track delta and knowledge retrieval", () => {
  test("formats negative track delta and budget degrade without from", async () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "debug", path: "events", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    await appendTurnEvent(k, { kind: "track.delta", track: "mood", delta: -2, before: 10, after: 8 });
    await appendTurnEvent(k, { kind: "budget.degraded", action: "drop_s2" });
    const ex = buildExplanation(k, "turn_1", "debug");
    expect(ex.chain.some((c) => c.summary.includes("Track mood -2"))).toBe(true);
    expect(ex.chain.some((c) => c.summary.includes("Budget degraded: drop_s2"))).toBe(true);
  });

  test("gm viewer sees knowledge doc body on retrieval hits", async () => {
    const doc = testKnowledgeDoc({ id: "doc1", name: "Doc", body: "knowledge body", scope: "character" });
    const { k } = createFakeKernel({
      knowledge: [doc],
      policy: { visibility: { rules: [{ viewer: "gm", path: "events", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    await appendTurnEvent(k, {
      kind: "utterance",
      retrieval: [{ kind: "knowledge", id: "doc1", score: 0.9, owner: "npc1" }],
    });
    const ex = buildExplanation(k, "turn_1", "gm");
    const hit = ex.chain.find((c) => c.kind === "retrieval");
    expect((hit?.data as { text?: string })?.text).toBe("knowledge body");
  });
});
