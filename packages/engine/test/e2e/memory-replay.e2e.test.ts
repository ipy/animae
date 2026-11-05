import { describe, expect, test } from "bun:test";
import { stableStringify } from "../../src/store/util.ts";
import type { Engine } from "../../src/api.ts";
import type { EngineEvent, TurnChunk } from "../../src/types.ts";
import { collectTurn } from "./session-fixture.ts";
import { assertLogInvariants } from "./session-invariants.ts";
import { memoryStoryLlm, memoryStoryPreset, openMemoryEngine, seedKnowledgeDocs } from "./memory-fixture.ts";

function utteranceRetrievalLog(events: EngineEvent[]) {
  return events
    .filter((e) => e.kind === "utterance")
    .map((e) => (e as { retrieval?: unknown }).retrieval ?? null);
}

async function replayAll(engine: Engine): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const c of engine.timeline.replay(engine.timeline.current())) out.push(c);
  return out;
}

describe("memory replay e2e (I6 retrieval log)", () => {
  test("record then replay: identical utterances and retrieval logs on utterance events", async () => {
    const llm = memoryStoryLlm();
    const h = await openMemoryEngine({
      preset: memoryStoryPreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      modelMode: "record",
      sessionId: "mem_replay_i6",
      seedExtra: seedKnowledgeDocs,
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      for (let i = 0; i < 2; i++) {
        await collectTurn(
          h.engine.scene.turn({ sceneId, actor: "player", text: `line ${i}`, addressee: "npc1" }),
        );
      }
      await h.engine.scene.end(sceneId);
      const events = await h.engine.timeline.events();
      assertLogInvariants(events);
      const liveUtterances = events.filter((e) => e.kind === "utterance").map((e) => (e as { text?: string }).text);
      const liveRetrieval = utteranceRetrievalLog(events);
      const eventLog = stableStringify(events);
      await h.engine.close();

      const replayEngine = await h.reopen({ modelMode: "replay", sessionId: "mem_replay_i6_b" });
      const replayEvents = await replayEngine.timeline.events();
      expect(stableStringify(replayEvents)).toBe(eventLog);
      const replayUtterances = replayEvents.filter((e) => e.kind === "utterance").map((e) => (e as { text?: string }).text);
      expect(replayUtterances).toEqual(liveUtterances);
      expect(utteranceRetrievalLog(replayEvents)).toEqual(liveRetrieval);
      await replayAll(replayEngine);
      await replayEngine.close();
    } finally {
      await h.dispose();
    }
  });
});
