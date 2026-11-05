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
      { type: "text", text: "Sa", speaker: "npc-a", newUtterance: true },
      { type: "text", text: "lut", speaker: "npc-a" },
      { type: "text", text: "!", speaker: "npc-a" },
      { type: "done", turnId: "turn_0001", events: [] },
    ];
    const { ui, deltas, starts, ends } = await collectStream(chunks);
    expect(ui.transcript).toHaveLength(1);
    expect(ui.transcript[0]?.text).toBe("Salut!");
    expect(ui.transcript[0]?.complete).toBe(true);
    expect(starts).toBe(1);
    expect(ends).toBe(1);
    expect(deltas).toEqual(["Sa", "lut", "!"]);
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

  test("AbortSignal stops consumption and completes partial utterance", async () => {
    const ui = uiState();
    const ac = new AbortController();
    async function* gen(): AsyncGenerator<TurnChunk> {
      yield { type: "text", text: "part", speaker: "a", newUtterance: true };
      ac.abort();
      yield { type: "text", text: "tail", speaker: "a" };
    }
    await consumeTurnStream(gen(), ui, { requestId: "r1", abortSignal: ac.signal });
    expect(ui.transcript[0]?.text).toBe("part");
    expect(ui.transcript[0]?.complete).toBe(true);
    expect(ui.speaking).toBe(false);
  });
});

describe("consumeTurnStream: narration", () => {
  test("a narration paragraph is one row with its style, streamed as its own segment", async () => {
    const calls: string[] = [];
    const ui = uiState();
    async function* gen(): AsyncGenerator<TurnChunk> {
      yield { type: "narration", text: "Rain ", style: "normal", newParagraph: true };
      yield { type: "narration", text: "falls.", style: "normal" };
      yield { type: "text", text: "Hi.", speaker: "npc", newUtterance: true };
      yield { type: "narration", text: "Later.", style: "scene_break", newParagraph: true };
      yield { type: "done", turnId: "turn_0001", events: [] };
    }
    await consumeTurnStream(gen(), ui, {
      requestId: "r1",
      stream: {
        onStreamStart: (_id, kind, _speaker, style) => calls.push(`start:${kind}${style ? `:${style}` : ""}`),
        onStreamDelta: (_id, text, kind) => calls.push(`delta:${kind}:${text}`),
        onStreamEnd: (_id, _turn, kind) => calls.push(`end:${kind}`),
      },
    });
    expect(ui.transcript.map((e) => [e.kind, e.style ?? null, e.text, e.complete])).toEqual([
      ["narration", "normal", "Rain falls.", true],
      ["dialogue", null, "Hi.", true],
      ["narration", "scene_break", "Later.", true],
    ]);
    expect(ui.transcript.at(-1)?.turnId).toBe("turn_0001");
    expect(calls).toEqual([
      "start:narration:normal",
      "delta:narration:Rain ",
      "delta:narration:falls.",
      "end:narration",
      "start:dialogue",
      "delta:dialogue:Hi.",
      "end:dialogue",
      "start:narration:scene_break",
      "delta:narration:Later.",
      "end:narration",
    ]);
  });

  test("a cue or choices end the open paragraph", async () => {
    const ui = uiState();
    async function* gen(): AsyncGenerator<TurnChunk> {
      yield { type: "narration", text: "Dusk.", newParagraph: true };
      yield { type: "choices", choices: [{ id: "c1", text: "Go on", expected_event_type: "other", tags: [] }] };
      yield { type: "done", turnId: "turn_0001", events: [] };
    }
    await consumeTurnStream(gen(), ui, { requestId: "r1" });
    expect(ui.transcript[0]?.complete).toBe(true);
    expect(ui.choices?.choices.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("consumeTurnStream: reset", () => {
  test("voids the output since the player's line, keeps the echo, and the replacement follows", async () => {
    const resets: string[] = [];
    const ui = uiState();
    async function* gen(): AsyncGenerator<TurnChunk> {
      yield { type: "text", text: "Hello", speaker: "player", newUtterance: true };
      yield { type: "narration", text: "Rain falls.", newParagraph: true };
      yield { type: "text", text: "Half a sen", speaker: "npc", newUtterance: true };
      yield { type: "choices", choices: [{ id: "c1", text: "Stale", expected_event_type: "other", tags: [] }] };
      yield { type: "reset", reason: "fallback" };
      yield { type: "text", text: "Hello back.", speaker: "npc", newUtterance: true };
      yield { type: "done", turnId: "turn_0001", events: [] };
    }
    await consumeTurnStream(gen(), ui, {
      requestId: "r1",
      actor: "player",
      stream: { onStreamReset: (_id, reason) => resets.push(reason) },
    });
    expect(resets).toEqual(["fallback"]);
    expect(ui.transcript.map((e) => [e.speaker ?? null, e.text])).toEqual([
      ["player", "Hello"],
      ["npc", "Hello back."],
    ]);
    expect(ui.choices).toBeUndefined();
  });

  test("an earlier turn's rows are never touched", async () => {
    const ui = uiState();
    async function* gen(): AsyncGenerator<TurnChunk> {
      yield { type: "text", text: "Earlier", speaker: "npc", newUtterance: true };
      yield { type: "done", turnId: "turn_0001", events: [] };
      yield { type: "text", text: "Next", speaker: "player", newUtterance: true };
      yield { type: "text", text: "Broken", speaker: "npc", newUtterance: true };
      yield { type: "reset", reason: "retry" };
      yield { type: "text", text: "Fixed", speaker: "npc", newUtterance: true };
      yield { type: "done", turnId: "turn_0002", events: [] };
    }
    await consumeTurnStream(gen(), ui, { requestId: "r1", actor: "player" });
    expect(ui.transcript.map((e) => e.text)).toEqual(["Earlier", "Next", "Fixed"]);
  });

  test("a reset before anything was shown is harmless", async () => {
    const ui = uiState();
    async function* gen(): AsyncGenerator<TurnChunk> {
      yield { type: "reset", reason: "fallback" };
      yield { type: "text", text: "Hi.", speaker: "npc", newUtterance: true };
      yield { type: "done", turnId: "turn_0001", events: [] };
    }
    await consumeTurnStream(gen(), ui, { requestId: "r1" });
    expect(ui.transcript.map((e) => e.text)).toEqual(["Hi."]);
  });
});
