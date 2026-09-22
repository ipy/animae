import type { CharacterId, TurnChunk } from "./types.ts";

export type TextTurnChunk = Extract<TurnChunk, { type: "text" }>;

export type UtteranceStreamState = {
  /** Active transcript/stream utterance id (caller-owned). */
  entryId?: string;
  /** Full text accumulated for the open utterance. */
  text: string;
  speaker?: CharacterId;
  /** Whether an utterance is open (between first fragment and done/abort). */
  open: boolean;
  /** Whether stream start was already signaled for the open utterance. */
  streamStarted: boolean;
};

export function createUtteranceStreamState(): UtteranceStreamState {
  return { text: "", open: false, streamStarted: false };
}

export type TextChunkApplyResult = {
  state: UtteranceStreamState;
  /** True when the prior open utterance should be marked complete before applying this chunk. */
  completePrior: boolean;
  /** True when this chunk starts a new utterance row. */
  newUtterance: boolean;
  /** Incremental fragment to append (same as chunk.text when new; delta when continuing). */
  delta: string;
};

/**
 * Apply one `text` TurnChunk to utterance state.
 * Contract: consecutive same-speaker `text` chunks without `newUtterance` append one utterance;
 * `newUtterance`, speaker change, or a `done` chunk (handled by caller) closes the prior utterance.
 */
export function applyTextTurnChunk(
  state: UtteranceStreamState,
  chunk: TextTurnChunk,
): TextChunkApplyResult {
  const speaker = chunk.speaker;
  const startsNew =
    chunk.newUtterance === true ||
    !state.open ||
    (speaker !== undefined && state.speaker !== undefined && speaker !== state.speaker);

  if (startsNew) {
    const next: UtteranceStreamState = {
      entryId: state.entryId,
      text: chunk.text,
      speaker,
      open: true,
      streamStarted: false,
    };
    return {
      state: next,
      completePrior: state.open,
      newUtterance: true,
      delta: chunk.text,
    };
  }

  const delta = chunk.text;
  const text = state.text + delta;
  return {
    state: { ...state, text, speaker: speaker ?? state.speaker, open: true },
    completePrior: false,
    newUtterance: false,
    delta,
  };
}

export function closeUtteranceStream(state: UtteranceStreamState): UtteranceStreamState {
  return { entryId: undefined, text: "", speaker: undefined, open: false, streamStarted: false };
}
