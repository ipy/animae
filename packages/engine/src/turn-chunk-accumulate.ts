import type { CharacterId, NarrationStyle, TurnChunk } from "./types.ts";

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

export type NarrationTurnChunk = Extract<TurnChunk, { type: "narration" }>;

export type ParagraphStreamState = {
  /** Active transcript/stream paragraph id (caller-owned). */
  entryId?: string;
  /** Full text accumulated for the open paragraph. */
  text: string;
  style: NarrationStyle;
  /** Whether a paragraph is open (between its first fragment and the chunk that ends it). */
  open: boolean;
  /** Whether stream start was already signaled for the open paragraph. */
  streamStarted: boolean;
};

export function createParagraphStreamState(): ParagraphStreamState {
  return { text: "", style: "normal", open: false, streamStarted: false };
}

export type NarrationChunkApplyResult = {
  state: ParagraphStreamState;
  /** True when the prior open paragraph should be marked complete before applying this chunk. */
  completePrior: boolean;
  /** True when this chunk starts a new paragraph row. */
  newParagraph: boolean;
  /** Incremental fragment to append (same as chunk.text when new; delta when continuing). */
  delta: string;
};

/**
 * Apply one `narration` TurnChunk to paragraph state.
 * Contract: consecutive narration fragments without `newParagraph` append to one paragraph; `newParagraph`, a change
 * of style, or any other chunk (`text`, `cue`, `choices`, `done`, handled by the caller) closes the prior paragraph.
 */
export function applyNarrationTurnChunk(state: ParagraphStreamState, chunk: NarrationTurnChunk): NarrationChunkApplyResult {
  const style: NarrationStyle = chunk.style ?? "normal";
  const startsNew = chunk.newParagraph === true || !state.open || state.style !== style;
  if (startsNew) {
    return {
      state: { entryId: state.entryId, text: chunk.text, style, open: true, streamStarted: false },
      completePrior: state.open,
      newParagraph: true,
      delta: chunk.text,
    };
  }
  return {
    state: { ...state, text: state.text + chunk.text, open: true },
    completePrior: false,
    newParagraph: false,
    delta: chunk.text,
  };
}

export function closeParagraphStream(_state: ParagraphStreamState): ParagraphStreamState {
  return createParagraphStreamState();
}

/**
 * The player's own line, echoed as the first `text` chunk of a turn (spoken by the acting character). It is not part
 * of the output a `reset` chunk discards: consumers keep it and drop everything after it.
 */
export function isActorEcho(chunk: TurnChunk, actor: CharacterId | undefined): boolean {
  return chunk.type === "text" && actor !== undefined && chunk.speaker === actor && chunk.autonomous !== true;
}
