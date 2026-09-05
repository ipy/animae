import { useCallback, useRef } from "react";
import type { TurnChunk } from "@animae/engine";
import { useEngineContext } from "../context/engine-context.tsx";
import { useAppState } from "../context/app-state-context.tsx";

let entrySeq = 0;

export function useTurn() {
  const { engine, actor } = useEngineContext();
  const { state, dispatch, commandApi } = useAppState();
  const streamRef = useRef<AsyncIterable<TurnChunk> | undefined>(undefined);

  const submit = useCallback(
    async (text: string, choiceId?: string) => {
      const sceneId = commandApi.sceneId();
      if (!sceneId) {
        dispatch({ type: "systemLine", text: "No active scene — use :commands or start a scene." });
        return;
      }
      dispatch({ type: "setPending", pending: true });
      dispatch({ type: "setTurnError", error: undefined });
      dispatch({ type: "setChoices", choices: undefined });
      try {
        const stream = engine.scene.turn({
          sceneId,
          actor,
          text,
          choiceId,
        });
        streamRef.current = stream;
        await consumeTurnStream(stream, dispatch);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: "setTurnError", error: msg });
        dispatch({ type: "systemLine", text: msg });
      } finally {
        dispatch({ type: "setPending", pending: false });
        dispatch({ type: "setSpeaking", speaking: false });
        streamRef.current = undefined;
      }
    },
    [engine, actor, commandApi, dispatch],
  );

  return {
    submit,
    speaking: state.speaking,
    pending: state.pending,
    sceneId: state.sceneId,
    error: state.turnError,
  };
}

async function consumeTurnStream(
  stream: AsyncIterable<TurnChunk>,
  dispatch: ReturnType<typeof useAppState>["dispatch"],
) {
  let textBuffer = "";
  let speaker: string | undefined;
  let cues: Array<{ type: string; args: Record<string, unknown>; at: number; speaker?: string }> =
    [];
  let entryId: string | undefined;

  for await (const chunk of stream) {
    switch (chunk.type) {
      case "text": {
        if (entryId) {
          dispatch({ type: "patchTranscript", id: entryId, patch: { complete: true } });
        }
        textBuffer = chunk.text;
        speaker = chunk.speaker;
        cues = [];
        entryId = `dlg_${++entrySeq}`;
        dispatch({ type: "setSpeaking", speaking: true });
        dispatch({
          type: "appendTranscript",
          entry: {
            id: entryId,
            kind: "dialogue",
            speaker,
            text: textBuffer,
            cues: [],
            complete: false,
          },
        });
        break;
      }
      case "cue": {
        cues.push({
          type: chunk.cue.type,
          args: chunk.cue.args,
          at: chunk.at,
          speaker: chunk.speaker,
        });
        if (entryId) {
          dispatch({
            type: "patchTranscript",
            id: entryId,
            patch: { cues: [...cues] },
          });
        } else if (chunk.cue.type === "action") {
          const id = `act_${++entrySeq}`;
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
          entryId = id;
        }
        break;
      }
      case "choices": {
        dispatch({
          type: "setChoices",
          choices: {
            choices: chunk.choices.map((c) => ({ id: c.id, text: c.text })),
            selected: 0,
          },
        });
        dispatch({ type: "setFocus", focus: "choices" });
        break;
      }
      case "done": {
        if (entryId) {
          dispatch({
            type: "patchTranscript",
            id: entryId,
            patch: { complete: true, turnId: chunk.turnId },
          });
        }
        dispatch({ type: "setLastTurnId", turnId: chunk.turnId });
        dispatch({ type: "setSpeaking", speaking: false });
        entryId = undefined;
        textBuffer = "";
        cues = [];
        break;
      }
      default:
        break;
    }
  }
}
