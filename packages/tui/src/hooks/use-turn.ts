import { useCallback, useRef } from "react";
import type { TurnChunk } from "@animae/engine";
import { useEngineContext } from "../context/engine-context.tsx";
import { useAppState } from "../context/app-state-context.tsx";
import { useTuiI18n } from "../i18n/context.tsx";
import { consumeTurnStream } from "./consume-turn.ts";

export function useTurn() {
  const { engine, actor } = useEngineContext();
  const { t } = useTuiI18n();
  const { state, dispatch, commandApi, config } = useAppState();
  const streamRef = useRef<AsyncIterable<TurnChunk> | undefined>(undefined);

  const submit = useCallback(
    async (text: string, choiceId?: string) => {
      let sceneId = commandApi.sceneId();
      if (!sceneId && config.resolveFreeInput) {
        const routed = await config.resolveFreeInput({
          text,
          choiceId,
          api: commandApi,
          focusTarget: state.focusTarget,
          dispatch: (prompt, options) => {
            dispatch({ type: "systemLine", text: prompt });
            dispatch({
              type: "setChoices",
              choices: {
                choices: options.map((o) => ({ id: o.id, text: o.label })),
                selected: 0,
              },
            });
            dispatch({ type: "setFocus", focus: "choices" });
          },
        });
        if (routed === "handled") return;
        sceneId = commandApi.sceneId();
      }
      if (!sceneId) {
        dispatch({
          type: "systemLine",
          text: config.resolveFreeInput
            ? t("turn.no_scene_free_roam")
            : t("turn.no_scene_default"),
        });
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
        await consumeTurnStream(stream, dispatch, { actor });
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
    [engine, actor, commandApi, dispatch, config, state.focusTarget, t],
  );

  return {
    submit,
    speaking: state.speaking,
    pending: state.pending,
    sceneId: state.sceneId,
    error: state.turnError,
  };
}
