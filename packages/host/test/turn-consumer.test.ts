import { describe, expect, test } from "bun:test";
import type { TurnChunk } from "@animae/engine";
import { consumeTurnStream } from "../src/turn-consumer.ts";
import type { HostSessionUiState } from "../src/types.ts";

function uiState(): HostSessionUiState {
  return {
    sceneId: undefined,
    hasScene: true,
    pending: false,
    speaking: false,
    transcript: [],
    transcriptLimit: 100,
  };
}

async function collectStream(chunks: TurnChunk[], opts?: { abortAt?: number }) {
  const ui = uiState();
  const deltas: string[] = [];
  let starts = 0;
  let ends = 0;
  async function* gen() {
    for (let i = 0; i < chunks.length; i++) {
      if (opts?.abortAt === i) return;
      yield chunks[i]!;
    }
  }
  await consumeTurnStream(gen(), ui, {
    requestId: "r1",
    stream: {
      onStreamStart: () => {
        starts += 1;
      },
      onStreamDelta: (_id, d) => deltas.push(d),
      onStreamEnd: () => {
        ends += 1;
      },
    },
  });
  return { ui, deltas, starts, ends };
}

describe("consumeTurnStream", () => {
  test("one transcript row and stream per utterance with token chunks", async () => {
    const chunks: TurnChunk[] = [
      { type: "text", text: "你", speaker: "npc-a", newUtterance: true },
      { type: "text", text: "好", speaker: "npc-a" },
      { type: "text", text: "。", speaker: "npc-a" },
      { type: "done", turnId: "turn_0001", events: [] },
    ];
    const { ui, deltas, starts, ends } = await collectStream(chunks);
    expect(ui.transcript).toHaveLength(1);
    expect(ui.transcript[0]?.text).toBe("你好。");
    expect(ui.transcript[0]?.complete).toBe(true);
    expect(starts).toBe(1);
    expect(ends).toBe(1);
    expect(deltas).toEqual(["你", "好", "。"]);
  });

  test("two sub-turns with different speakers", async () => {
    const chunks: TurnChunk[] = [
      { type: "text", text: "Hi", speaker: "a", newUtterance: true },
      { type: "done", turnId: "turn_0001", events: [] },
      { type: "text", text: "Yo", speaker: "b", newUtterance: true },
      { type: "done", turnId: "turn_0002", events: [] },
    ];
    const { ui, starts, ends } = await collectStream(chunks);
    expect(ui.transcript).toHaveLength(2);
    expect(ui.transcript[0]?.text).toBe("Hi");
    expect(ui.transcript[1]?.text).toBe("Yo");
    expect(starts).toBe(2);
    expect(ends).toBe(2);
  });

  test("error mid-stream marks partial complete", async () => {
    const ui = uiState();
    async function* gen() {
      yield { type: "text", text: "part", speaker: "a", newUtterance: true } as TurnChunk;
      throw new Error("boom");
    }
    await expect(
      consumeTurnStream(gen(), ui, { requestId: "r1" }),
    ).rejects.toThrow("boom");
    expect(ui.transcript).toHaveLength(1);
    expect(ui.transcript[0]?.text).toBe("part");
    expect(ui.transcript[0]?.complete).toBe(true);
  });

  test("abort mid-stream marks partial complete", async () => {
    const chunks: TurnChunk[] = [
      { type: "text", text: "partial", speaker: "a", newUtterance: true },
      { type: "text", text: "…", speaker: "a" },
      { type: "done", turnId: "turn_0001", events: [] },
    ];
    const { ui } = await collectStream(chunks, { abortAt: 1 });
    expect(ui.transcript.length).toBeGreaterThanOrEqual(1);
    expect(ui.transcript[0]?.complete).toBe(true);
  });
});
