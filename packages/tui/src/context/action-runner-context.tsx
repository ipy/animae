import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type {
  ActionArgField,
  ActionContext,
  EntityTuiAction,
  PromptRequest,
  TuiAction,
} from "../types.ts";
import { useAppState } from "./app-state-context.tsx";
import { useEngineContext } from "./engine-context.tsx";

type PromptResolver = (values: Record<string, string>) => void | Promise<void>;

export interface ActionRunnerValue {
  actions: TuiAction[];
  entityActions: EntityTuiAction[];
  actionContext: ActionContext;
  runAction: (action: TuiAction, presetArgs?: Record<string, string>) => Promise<void>;
  runEntityAction: (
    action: EntityTuiAction,
    entityId: string,
    presetArgs?: Record<string, string>,
  ) => Promise<void>;
  openPrompt: (req: PromptRequest, onComplete: PromptResolver) => void;
  completePrompt: (values: Record<string, string>) => Promise<void>;
}

const ActionRunnerContext = createContext<ActionRunnerValue | undefined>(undefined);

function needsPrompt(
  fields: ActionArgField[] | undefined,
  preset?: Record<string, string>,
): ActionArgField[] | undefined {
  if (!fields?.length) return undefined;
  const missing = fields.filter((f) => !f.optional && !(preset && preset[f.id]?.length));
  return missing.length ? fields : undefined;
}

export function ActionRunnerProvider({
  actions,
  entityActions,
  children,
}: {
  actions: TuiAction[];
  entityActions: EntityTuiAction[];
  children: ReactNode;
}) {
  const { state, dispatch, commandApi } = useAppState();
  const { engine, viewer, actor } = useEngineContext();
  const promptDoneRef = useRef<PromptResolver | undefined>(undefined);

  const actionContext: ActionContext = useMemo(
    () => ({
      engine,
      viewer,
      actor,
      sceneId: commandApi.sceneId,
      focusTarget: state.focusTarget,
      commandApi,
    }),
    [engine, viewer, actor, commandApi, state.focusTarget],
  );

  const completePrompt = useCallback(
    async (values: Record<string, string>) => {
      const done = promptDoneRef.current;
      promptDoneRef.current = undefined;
      dispatch({ type: "setPrompt", prompt: undefined });
      if (done) await done(values);
    },
    [dispatch],
  );

  const openPrompt = useCallback(
    (req: PromptRequest, onComplete: PromptResolver) => {
      promptDoneRef.current = onComplete;
      const values: Record<string, string> = { ...(req.initial ?? {}) };
      dispatch({
        type: "setPrompt",
        prompt: {
          title: req.title,
          fields: req.fields,
          values,
          fieldIndex: 0,
        },
      });
    },
    [dispatch],
  );

  const runWithArgs = useCallback(
    async (
      fields: ActionArgField[] | undefined,
      preset: Record<string, string> | undefined,
      run: (args: Record<string, string>) => void | Promise<void>,
    ) => {
      const required = needsPrompt(fields, preset);
      if (!required) {
        const merged: Record<string, string> = {};
        for (const f of fields ?? []) {
          merged[f.id] = preset?.[f.id] ?? "";
        }
        await run(merged);
        return;
      }
      openPrompt({ title: "输入", fields: required, initial: preset }, async (values) => {
        const merged: Record<string, string> = { ...(preset ?? {}), ...values };
        await run(merged);
      });
    },
    [openPrompt],
  );

  const runAction = useCallback(
    async (action: TuiAction, presetArgs?: Record<string, string>) => {
      await runWithArgs(action.args, presetArgs, (args) => action.run(actionContext, args));
    },
    [actionContext, runWithArgs],
  );

  const runEntityAction = useCallback(
    async (action: EntityTuiAction, entityId: string, presetArgs?: Record<string, string>) => {
      await runWithArgs(action.args, presetArgs, (args) =>
        action.run(actionContext, entityId, args),
      );
    },
    [actionContext, runWithArgs],
  );

  const value = useMemo(
    (): ActionRunnerValue => ({
      actions,
      entityActions,
      actionContext,
      runAction,
      runEntityAction,
      openPrompt,
      completePrompt,
    }),
    [actions, entityActions, actionContext, runAction, runEntityAction, openPrompt, completePrompt],
  );

  return <ActionRunnerContext.Provider value={value}>{children}</ActionRunnerContext.Provider>;
}

export function useActionRunner(): ActionRunnerValue {
  const ctx = useContext(ActionRunnerContext);
  if (!ctx) throw new Error("useActionRunner requires ActionRunnerProvider");
  return ctx;
}
