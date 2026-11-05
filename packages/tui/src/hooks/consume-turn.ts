import {
  applyNarrationTurnChunk,
  applyTextTurnChunk,
  createParagraphStreamState,
  createUtteranceStreamState,
  isActorEcho,
  type TurnChunk,
} from "@animae/engine";
import type { AppStateAction } from "../context/app-state-context.tsx";

let entrySeq = 0;

export interface ConsumeTurnOptions {
  /**
   * The acting character. The engine echoes the player's line as the first `text` chunk of a turn; a `reset` chunk
   * drops everything the turn showed after that line but keeps the line itself.
   */
  actor?: string;
}

/**
 * Turn a turn's chunk stream into transcript entries:
 *  - `text` → one `dialogue` row per utterance (the row grows while fragments arrive),
 *  - `narration` → one `narration` row per paragraph, with its `style`,
 *  - `cue` → expression/sfx cues on the open row, or an `action` row,
 *  - `choices` → the choice menu,
 *  - `reset` → the output of the turn was replaced (for example the rule backend took over after the model failed
 *    mid-stream): rows created since the player's line are dropped, choices offered since the last `done` are cleared,
 *    and the replacement that follows is shown instead,
 *  - `done` → the turn is complete.
 */
export async function consumeTurnStream(
  stream: AsyncIterable<TurnChunk>,
  dispatch: (action: AppStateAction) => void,
  opts: ConsumeTurnOptions = {},
): Promise<void> {
  let utterance = createUtteranceStreamState();
  let paragraph = createParagraphStreamState();
  let cues: Array<{ type: string; args: Record<string, unknown>; at: number; speaker?: string }> = [];
  /** Rows this turn created after the player's own line: what a `reset` removes. */
  let outputRows: string[] = [];
  let choicesOffered = false;
  let deferredChoices: Extract<TurnChunk, { type: "choices" }>["choices"] | undefined;

  const completeUtterance = (turnId?: string) => {
    if (utterance.entryId) {
      dispatch({
        type: "patchTranscript",
        id: utterance.entryId,
        patch: turnId === undefined ? { complete: true } : { complete: true, turnId },
      });
    }
    utterance = createUtteranceStreamState();
    cues = [];
  };

  const completeParagraph = (turnId?: string) => {
    if (paragraph.entryId) {
      dispatch({
        type: "patchTranscript",
        id: paragraph.entryId,
        patch: turnId === undefined ? { complete: true } : { complete: true, turnId },
      });
    }
    paragraph = createParagraphStreamState();
  };

  const discardOutput = () => {
    // The player's own line may still be open; it stays, so it must not be left half-typed.
    if (utterance.entryId && !outputRows.includes(utterance.entryId)) {
      dispatch({ type: "patchTranscript", id: utterance.entryId, patch: { complete: true } });
    }
    dispatch({ type: "removeTranscript", ids: outputRows });
    outputRows = [];
    utterance = createUtteranceStreamState();
    paragraph = createParagraphStreamState();
    cues = [];
    if (choicesOffered) {
      dispatch({ type: "setChoices", choices: undefined });
      dispatch({ type: "setFocus", focus: "input" });
      choicesOffered = false;
      deferredChoices = undefined;
    }
    dispatch({ type: "setSpeaking", speaking: false });
  };

  try {
    for await (const chunk of stream) {
      switch (chunk.type) {
        case "text": {
          completeParagraph();
          const applied = applyTextTurnChunk(utterance, chunk);
          if (applied.completePrior) completeUtterance();
          utterance = applied.state;

          if (applied.newUtterance) {
            const entryId = `dlg_${++entrySeq}`;
            utterance = { ...utterance, entryId };
            if (!isActorEcho(chunk, opts.actor)) outputRows.push(entryId);
            dispatch({ type: "setSpeaking", speaking: true });
            dispatch({
              type: "appendTranscript",
              entry: {
                id: entryId,
                kind: "dialogue",
                speaker: utterance.speaker,
                text: applied.delta,
                cues: [],
                complete: false,
              },
            });
          } else if (utterance.entryId) {
            dispatch({
              type: "patchTranscript",
              id: utterance.entryId,
              patch: { text: utterance.text },
            });
          }
          break;
        }
        case "narration": {
          // A paragraph belongs to the narrator: whatever character was speaking has finished.
          completeUtterance();
          const applied = applyNarrationTurnChunk(paragraph, chunk);
          if (applied.completePrior) completeParagraph();
          paragraph = applied.state;

          if (applied.newParagraph) {
            const entryId = `nar_${++entrySeq}`;
            paragraph = { ...paragraph, entryId };
            outputRows.push(entryId);
            dispatch({
              type: "appendTranscript",
              entry: {
                id: entryId,
                kind: "narration",
                style: paragraph.style,
                text: applied.delta,
                complete: false,
              },
            });
          } else if (paragraph.entryId) {
            dispatch({
              type: "patchTranscript",
              id: paragraph.entryId,
              patch: { text: paragraph.text },
            });
          }
          break;
        }
        case "cue": {
          completeParagraph();
          cues.push({
            type: chunk.cue.type,
            args: chunk.cue.args,
            at: chunk.at,
            speaker: chunk.speaker,
          });
          if (utterance.entryId) {
            dispatch({
              type: "patchTranscript",
              id: utterance.entryId,
              patch: { cues: [...cues] },
            });
          } else if (chunk.cue.type === "action") {
            const id = `act_${++entrySeq}`;
            outputRows.push(id);
            dispatch({
              type: "appendTranscript",
              entry: {
                id,
                kind: "action",
                text: String(chunk.cue.args["text"] ?? ""),
                cues: [{ type: chunk.cue.type, args: chunk.cue.args, at: chunk.at }],
                complete: false,
              },
            });
            utterance = { ...utterance, entryId: id, open: true, text: String(chunk.cue.args["text"] ?? "") };
          }
          break;
        }
        case "choices": {
          completeParagraph();
          choicesOffered = true;
          deferredChoices = chunk.choices;
          break;
        }
        case "reset": {
          discardOutput();
          break;
        }
        case "done": {
          completeParagraph(chunk.turnId);
          if (utterance.entryId) {
            dispatch({
              type: "patchTranscript",
              id: utterance.entryId,
              patch: { complete: true, turnId: chunk.turnId },
            });
          }
          dispatch({ type: "setLastTurnId", turnId: chunk.turnId });
          dispatch({ type: "setSpeaking", speaking: false });
          utterance = createUtteranceStreamState();
          cues = [];
          outputRows = [];
          choicesOffered = false;
          break;
        }
        default:
          break;
      }
    }
  } finally {
    completeUtterance();
    completeParagraph();
    if (deferredChoices && deferredChoices.length > 0) {
      dispatch({
        type: "setChoices",
        choices: {
          choices: deferredChoices.map((c) => ({ id: c.id, text: c.text })),
          selected: 0,
        },
      });
      dispatch({ type: "setFocus", focus: "choices" });
    }
  }
}
