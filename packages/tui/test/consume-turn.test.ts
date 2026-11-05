import { describe, expect, test } from "bun:test";
import type { TurnChunk } from "@animae/engine";
import { appStateReducer, initialAppState, type AppState, type AppStateAction } from "../src/context/app-state-context.tsx";
import { consumeTurnStream } from "../src/hooks/consume-turn.ts";

/** Plays chunks through the consumer into the real reducer; `after[i]` runs once chunk `i` has been applied. */
async function play(
  chunks: TurnChunk[],
  opts: { actor?: string; seed?: (s: AppState) => AppState; after?: Record<number, (s: AppState) => void> } = {},
): Promise<{ state: AppState; actions: AppStateAction[] }> {
  let state = opts.seed ? opts.seed(initialAppState()) : initialAppState();
  const actions: AppStateAction[] = [];
  const dispatch = (a: AppStateAction) => {
    actions.push(a);
    state = appStateReducer(state, a);
  };
  async function* gen(): AsyncGenerator<TurnChunk> {
    for (const [i, chunk] of chunks.entries()) {
      yield chunk;
      opts.after?.[i]?.(state);
    }
  }
  await consumeTurnStream(gen(), dispatch, { actor: opts.actor });
  return { state, actions };
}

const done: TurnChunk = { type: "done", turnId: "turn_0001", events: [] };
const rows = (s: AppState) => s.transcript.map((e) => [e.kind, e.style ?? null, e.speaker ?? null, e.text]);

describe("narration rows", () => {
  test("a paragraph is one row that grows with its fragments and carries its style", async () => {
    const seen: string[] = [];
    const { state } = await play(
      [
        { type: "narration", text: "Rain ", style: "normal", newParagraph: true },
        { type: "narration", text: "falls.", style: "normal" },
        done,
      ],
      { after: { 1: (s) => seen.push(s.transcript[0]!.text) } },
    );
    expect(seen).toEqual(["Rain falls."]);
    expect(rows(state)).toEqual([["narration", "normal", null, "Rain falls."]]);
    expect(state.transcript[0]).toMatchObject({ complete: true, turnId: "turn_0001" });
  });

  test("style defaults to normal and a change of style starts a new paragraph", async () => {
    const { state } = await play([
      { type: "narration", text: "One." },
      { type: "narration", text: "Two.", style: "scene_break" },
      { type: "narration", text: "Three.", style: "scene_break", newParagraph: true },
      done,
    ]);
    expect(rows(state)).toEqual([
      ["narration", "normal", null, "One."],
      ["narration", "scene_break", null, "Two."],
      ["narration", "scene_break", null, "Three."],
    ]);
    expect(state.transcript.every((e) => e.complete)).toBe(true);
  });

  test("narration, dialogue and narration interleave in stream order, each closing the one before", async () => {
    const { state } = await play([
      { type: "narration", text: "Dusk.", newParagraph: true },
      { type: "text", text: "Hello.", speaker: "mira", newUtterance: true },
      { type: "narration", text: "She smiles.", newParagraph: true },
      done,
    ]);
    expect(rows(state)).toEqual([
      ["narration", "normal", null, "Dusk."],
      ["dialogue", null, "mira", "Hello."],
      ["narration", "normal", null, "She smiles."],
    ]);
    expect(state.transcript.every((e) => e.complete)).toBe(true);
    expect(state.speaking).toBe(false);
  });

  test("a stream that ends without done still closes its rows", async () => {
    const { state } = await play([{ type: "narration", text: "Dusk.", newParagraph: true }]);
    expect(state.transcript[0]!.complete).toBe(true);
  });

  test("choices end the open paragraph", async () => {
    const { state } = await play([
      { type: "narration", text: "Dusk.", newParagraph: true },
      { type: "choices", choices: [{ id: "c1", text: "Wait", expected_event_type: "other", tags: [] }] },
      done,
    ]);
    expect(state.transcript[0]!.complete).toBe(true);
    expect(state.choices?.choices.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("reset", () => {
  const echo: TurnChunk = { type: "text", text: "Hello", speaker: "player", newUtterance: true };

  test("drops what the turn showed after the player's line and shows the replacement", async () => {
    const { state } = await play(
      [
        echo,
        { type: "narration", text: "Rain falls.", newParagraph: true },
        { type: "text", text: "Half a sen", speaker: "mira", newUtterance: true },
        { type: "reset", reason: "fallback" },
        { type: "text", text: "Hello back.", speaker: "mira", newUtterance: true },
        done,
      ],
      { actor: "player" },
    );
    expect(rows(state)).toEqual([
      ["dialogue", null, "player", "Hello"],
      ["dialogue", null, "mira", "Hello back."],
    ]);
    expect(state.transcript.every((e) => e.complete)).toBe(true);
  });

  test("clears choices that were offered since the last done and returns focus to the input", async () => {
    const { state } = await play(
      [
        echo,
        { type: "choices", choices: [{ id: "c1", text: "Stale", expected_event_type: "other", tags: [] }] },
        { type: "reset", reason: "retry" },
        { type: "text", text: "Fresh.", speaker: "mira", newUtterance: true },
        done,
      ],
      { actor: "player" },
    );
    expect(state.choices).toBeUndefined();
    expect(state.focus).toBe("input");
  });

  test("never touches rows of earlier turns or system lines", async () => {
    const { state } = await play(
      [
        { type: "text", text: "Earlier", speaker: "mira", newUtterance: true },
        done,
        echo,
        { type: "text", text: "Broken", speaker: "mira", newUtterance: true },
        { type: "reset", reason: "fallback" },
        { type: "text", text: "Fixed", speaker: "mira", newUtterance: true },
        { ...done, turnId: "turn_0002" },
      ],
      {
        actor: "player",
        seed: (s) => appStateReducer(s, { type: "systemLine", text: "fell back to rules" }),
        after: {},
      },
    );
    expect(state.transcript.map((e) => e.text)).toEqual(["fell back to rules", "Earlier", "Hello", "Fixed"]);
  });

  test("the player's own line is not left half-typed", async () => {
    const { state } = await play(
      [echo, { type: "narration", text: "Rain.", newParagraph: true }, { type: "reset", reason: "fallback" }, done],
      { actor: "player" },
    );
    expect(state.transcript.map((e) => [e.text, e.complete])).toEqual([["Hello", true]]);
  });

  test("a reset before anything was shown is harmless", async () => {
    const { state } = await play([
      { type: "reset", reason: "fallback" },
      { type: "text", text: "Hi.", speaker: "mira", newUtterance: true },
      done,
    ]);
    expect(state.transcript.map((e) => e.text)).toEqual(["Hi."]);
  });

  test("an action row created by a cue is dropped too", async () => {
    const { state } = await play(
      [
        echo,
        { type: "cue", cue: { type: "action", args: { text: "waves" } }, at: 0 },
        { type: "reset", reason: "fallback" },
        done,
      ],
      { actor: "player" },
    );
    expect(state.transcript.map((e) => e.kind)).toEqual(["dialogue"]);
  });
});

describe("removeTranscript", () => {
  test("keeps the scroll offset inside the shorter transcript", () => {
    let state = initialAppState();
    for (const text of ["a", "b", "c", "d", "e"]) state = appStateReducer(state, { type: "systemLine", text });
    state = appStateReducer(state, { type: "scrollTranscript", delta: 4 });
    const ids = state.transcript.slice(2).map((e) => e.id);
    state = appStateReducer(state, { type: "removeTranscript", ids });
    expect(state.transcript.map((e) => e.text)).toEqual(["a", "b"]);
    expect(state.transcriptScroll).toBe(1);
  });

  test("an empty id list changes nothing", () => {
    const state = initialAppState();
    expect(appStateReducer(state, { type: "removeTranscript", ids: [] })).toBe(state);
  });
});
