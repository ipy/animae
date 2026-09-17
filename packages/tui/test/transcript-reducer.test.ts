import { describe, expect, test } from "bun:test";
import { appStateReducer, initialAppState, type AppState } from "../src/context/app-state-context.tsx";
import { MAX_TRANSCRIPT_ENTRIES } from "../src/utils/transcript-limits.ts";

const say = (state: AppState, text: string): AppState => appStateReducer(state, { type: "systemLine", text });

describe("system lines", () => {
  test("a multi-line message becomes one entry per line, blank lines kept", () => {
    const next = say(initialAppState(), "head\n\nbody\ntail");
    expect(next.transcript.map((e) => e.text)).toEqual(["head", " ", "body", "tail"]);
    expect(next.transcript.every((e) => e.kind === "system" && e.complete)).toBe(true);
  });

  test("entry ids stay unique after the transcript has been trimmed", () => {
    let state = initialAppState();
    for (let i = 0; i < MAX_TRANSCRIPT_ENTRIES + 30; i++) state = say(state, `line ${i}`);
    expect(state.transcript.length).toBe(MAX_TRANSCRIPT_ENTRIES);
    expect(new Set(state.transcript.map((e) => e.id)).size).toBe(MAX_TRANSCRIPT_ENTRIES);
    expect(state.transcript.at(-1)!.text).toBe(`line ${MAX_TRANSCRIPT_ENTRIES + 29}`);
  });
});

describe("transcript scroll", () => {
  const scroll = (state: AppState, delta: number): AppState => appStateReducer(state, { type: "scrollTranscript", delta });

  test("moves by entries and never past the oldest or the newest", () => {
    let state = say(initialAppState(), "a\nb\nc\nd\ne");
    expect(scroll(state, 2).transcriptScroll).toBe(2);
    expect(scroll(state, 99).transcriptScroll).toBe(4);
    expect(scroll(scroll(state, 2), -9).transcriptScroll).toBe(0);
    state = appStateReducer(scroll(state, 3), { type: "scrollTranscriptTail" });
    expect(state.transcriptScroll).toBe(0);
  });

  test("an empty transcript cannot be scrolled", () => {
    expect(scroll(initialAppState(), 4).transcriptScroll).toBe(0);
  });
});
