import { Box, Text, useApp, useWindowSize } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { SgrMouseEvent } from "../input/mouse-sgr.ts";
import { useTheme } from "../hooks/use-theme.ts";
import type { LayoutProps, RunTuiOptions, SceneId } from "../types.ts";
import { EngineProvider, useEngineContext } from "../context/engine-context.tsx";
import { ThemeProvider } from "../context/theme-context.tsx";
import { KeymapProvider, useKeymapContext } from "../context/keymap-context.tsx";
import { AppStateProvider, useAppState } from "../context/app-state-context.tsx";
import { RunnerProvider } from "../context/runner-context.tsx";
import { defaultLayout } from "../layout/default-layout.tsx";
import { useParsedInput } from "../hooks/use-parsed-input.ts";
import { choiceIndexFromKey, matchKeyAction } from "../keymap/default.ts";
import { HelpOverlay } from "../components/HelpOverlay.tsx";
import { EventLog } from "../components/EventLog.tsx";
import { TimelineBrowser } from "../components/TimelineBrowser.tsx";
import { ExplainView } from "../components/ExplainView.tsx";
import { Inspector } from "../components/Inspector.tsx";
import { LoadSlots } from "../components/LoadSlots.tsx";
import { SidePanel } from "../components/SidePanel.tsx";
import { Overlay } from "../components/Overlay.tsx";
import { selectLayoutMode } from "../utils/layout-mode.ts";
import { useTurn } from "../hooks/use-turn.ts";
import { createCueRegistry } from "../cues/registry.ts";
import { loadTheme } from "../theme/load.ts";
import { runCommandLine } from "../commands/builtin.ts";
import {
  deleteGraphemeAfter,
  deleteGraphemeBefore,
  insertAtGrapheme,
} from "../utils/display-width.ts";
import { graphemeCount } from "../utils/grapheme.ts";
import { transcriptEntryWindow } from "../utils/transcript-limits.ts";
import { useMouseDispatch } from "../context/mouse-context.tsx";
import { MouseCaptureBridge } from "./MouseCaptureBridge.tsx";
import { ActionRunnerProvider } from "../context/action-runner-context.tsx";
import { CommandPalette } from "../components/CommandPalette.tsx";
import { PromptDialog, handlePromptKey } from "../components/PromptDialog.tsx";
import { EntityActionMenu } from "../components/EntityActionMenu.tsx";
import { useActionRunner } from "../context/action-runner-context.tsx";
import { applyTabAutocomplete } from "../components/AutocompletePopup.tsx";
import { buildPaletteEntries } from "../utils/action-list.ts";

export interface TuiAppProps extends RunTuiOptions {
  onReady?: () => void;
}

export function TuiApp(props: TuiAppProps) {
  const theme = loadTheme(props.theme);
  const cueRegistry = useMemo(
    () => createCueRegistry(props.cueRenderers),
    [props.cueRenderers],
  );
  const viewer = props.viewer ?? "player";
  const actor = props.actor ?? "player";
  const [initialSceneId, setInitialSceneId] = useState<SceneId | undefined>(() =>
    props.scene && "sceneId" in props.scene ? props.scene.sceneId : undefined,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!props.scene) return;
      if ("sceneId" in props.scene) {
        setInitialSceneId(props.scene.sceneId);
        return;
      }
      const id = await props.engine.scene.start(props.scene);
      if (!cancelled) setInitialSceneId(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.engine, props.scene]);

  useEffect(() => {
    if (props.scene && initialSceneId === undefined) return;
    props.onReady?.();
  }, [props.scene, initialSceneId, props.onReady]);

  const config = useMemo(
    () => ({
      cueRegistry,
      customCommands: props.commands ?? {},
      panels: props.panels ?? [],
      actions: props.actions ?? [],
      entityActions: props.entityActions ?? [],
      theme,
      onSceneEnd: props.onSceneEnd,
      nameHints: props.nameHints ?? [],
    }),
    [
      cueRegistry,
      props.commands,
      props.panels,
      props.actions,
      props.entityActions,
      theme,
      props.onSceneEnd,
      props.nameHints,
    ],
  );

  const Layout = (props.layout ?? defaultLayout) as ComponentType<LayoutProps>;

  return (
    <EngineProvider value={{ engine: props.engine, viewer, actor }}>
      <ThemeProvider theme={theme}>
        <KeymapProvider keymap={props.keymap}>
          <AppStateProvider
            engine={props.engine}
            viewer={viewer}
            actor={actor}
            config={config}
            initialSceneId={initialSceneId}
            initialMessage={props.initialMessage}
            header={props.header}
            footer={props.footer}
          >
            <MouseCaptureBridge
              mouseOption={props.mouse ?? "auto"}
              stdin={props.stdin}
              stdout={props.stdout}
            >
              <TuiShell
                Layout={Layout}
                exitOnCtrlC={props.exitOnCtrlC !== false}
                nameHints={props.nameHints ?? []}
              />
            </MouseCaptureBridge>
          </AppStateProvider>
        </KeymapProvider>
      </ThemeProvider>
    </EngineProvider>
  );
}

function TuiShell({
  Layout,
  exitOnCtrlC,
  nameHints,
}: {
  Layout: ComponentType<LayoutProps>;
  exitOnCtrlC: boolean;
  nameHints: string[];
}) {
  const { config } = useAppState();
  const dispatchMouse = useMouseDispatch();
  return (
    <ActionRunnerProvider actions={config.actions} entityActions={config.entityActions}>
      <TuiShellInner
        Layout={Layout}
        exitOnCtrlC={exitOnCtrlC}
        nameHints={nameHints}
        dispatchMouse={dispatchMouse}
      />
    </ActionRunnerProvider>
  );
}

function TuiShellInner({
  Layout,
  exitOnCtrlC,
  nameHints,
  dispatchMouse,
}: {
  Layout: ComponentType<LayoutProps>;
  exitOnCtrlC: boolean;
  nameHints: string[];
  dispatchMouse: ReturnType<typeof useMouseDispatch>;
}) {
  const app = useApp();
  const { engine, viewer, actor } = useEngineContext();
  const { state, dispatch, commandApi, config } = useAppState();
  const { submit } = useTurn();
  const { keymap } = useKeymapContext();
  const { columns, rows } = useWindowSize();
  const theme = useTheme();
  const mode = selectLayoutMode(columns, rows);
  const scrollPage = transcriptEntryWindow(rows);
  const sideW =
    mode === "two-column"
      ? Math.max(20, Math.floor((columns * theme.sidePanel.widthPercent) / 100))
      : 0;
  const transcriptCols = mode === "two-column" ? columns - sideW - 1 : columns;

  const handleMouse = useCallback(
    (ev: SgrMouseEvent) => {
      dispatchMouse(ev);
      if (ev.button !== "wheelUp" && ev.button !== "wheelDown") return;
      const col0 = ev.col - 1;
      const delta = ev.button === "wheelUp" ? 4 : -4;
      if (mode === "two-column" && col0 >= transcriptCols) {
        dispatch({ type: "scrollSide", delta });
      } else {
        dispatch({ type: "scrollTranscript", delta });
      }
    },
    [dispatchMouse, dispatch, mode, transcriptCols],
  );
  const [timelineIdx, setTimelineIdx] = useState(0);
  const [loadIdx, setLoadIdx] = useState(0);
  const inputDraftRef = useRef(state.inputDraft);
  const inputCursorRef = useRef(state.inputCursor);
  const { completePrompt, actions, entityActions, actionContext, runAction, runEntityAction } =
    useActionRunner();
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    inputDraftRef.current = state.inputDraft;
    inputCursorRef.current = state.inputCursor;
  }, [state.inputDraft, state.inputCursor]);

  const setInputDraft = (value: string, cursor: number) => {
    inputDraftRef.current = value;
    inputCursorRef.current = cursor;
    dispatch({ type: "setInputDraft", value, cursor });
  };

  const onQuit = async () => {
    app.exit();
    try {
      await engine.close();
    } catch {
      /* exit must not wait on in-flight model/scene work */
    }
  };

  useEffect(() => {
    return engine.on("route.decided", (e) => {
      const tier = (e as { tier?: string }).tier;
      if (tier === "s1" || tier === "s2") dispatch({ type: "setLastRoute", route: tier });
    });
  }, [engine, dispatch]);

  useEffect(() => {
    const onSignal = () => {
      void onQuit();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    return () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    };
  }, [onQuit]);

  useParsedInput(
    (ev) => {
      const s = stateRef.current;
      if (s.prompt) {
        void handlePromptKey(s, dispatch, completePrompt, ev);
        return;
      }

      if (s.paletteOpen) {
        if (ev.key.escape) {
          dispatch({ type: "setPalette", open: false });
          return;
        }
        if (ev.key.upArrow) {
          dispatch({ type: "setPalette", open: true, index: Math.max(0, s.paletteIndex - 1) });
          return;
        }
        if (ev.key.downArrow) {
          dispatch({ type: "setPalette", open: true, index: s.paletteIndex + 1 });
          return;
        }
        if (ev.key.backspace) {
          dispatch({
            type: "setPalette",
            open: true,
            query: s.paletteQuery.slice(0, -1),
            index: 0,
          });
          return;
        }
        if (ev.key.return) {
          void (async () => {
            const entries = buildPaletteEntries(
              s.paletteQuery,
              actionContext,
              actions,
              entityActions,
              config.customCommands,
              s.focusTarget,
            );
            const entry = entries[Math.min(s.paletteIndex, entries.length - 1)];
            dispatch({ type: "setPalette", open: false });
            if (!entry) return;
            if (entry.kind === "action" && entry.action) await runAction(entry.action);
            if (entry.kind === "entity" && entry.entityAction && s.focusTarget) {
              await runEntityAction(entry.entityAction, s.focusTarget);
            }
            if (entry.kind === "command" && entry.commandName) {
              const result = await runCommandLine(
                `:${entry.commandName}`,
                commandApi,
                config.customCommands,
              );
              if (result === "quit") void onQuit();
            }
          })();
          return;
        }
        if (!ev.ctrl && ev.input) {
          dispatch({
            type: "setPalette",
            open: true,
            query: s.paletteQuery + ev.input,
            index: 0,
          });
          return;
        }
        return;
      }

      if (s.typewriterActive && !s.overlay && !ev.ctrl) {
        dispatch({ type: "skipTypewriter" });
        // Input line must stay usable while intro typewriter runs (PTY `:help` / `:quit`).
        if (state.focus !== "input" || state.choices) {
          return;
        }
      }

      if (exitOnCtrlC && ev.ctrl && ev.name === "c") {
        void onQuit();
        return;
      }

      const action = matchKeyAction(keymap, ev.name, ev.input, {
        ctrl: ev.ctrl,
        shift: ev.shift,
      });

      if (state.overlay) {
        if (action === "closeOverlay" || ev.key.escape) {
          dispatch({ type: "setOverlay", overlay: undefined });
          dispatch({ type: "setPendingRewind", eventId: undefined });
          return;
        }
        if (state.overlay === "timeline") {
          if (ev.key.upArrow) setTimelineIdx((i) => Math.max(0, i - 1));
          if (ev.key.downArrow) setTimelineIdx((i) => i + 1);
          if (ev.key.return) {
            void engine.timeline.branches().then((bs) => {
              const name = bs[timelineIdx]?.name;
              if (name) void engine.timeline.switch(name);
            });
          }
        }
        if (state.overlay === "loadSlots") {
          if (ev.key.upArrow) setLoadIdx((i) => Math.max(0, i - 1));
          if (ev.key.downArrow) setLoadIdx((i) => i + 1);
          if (ev.key.return) {
            void engine.timeline.saves().then((saves) => {
              const slot = saves[loadIdx];
              if (slot) {
                void engine.timeline.load(slot).then(() => commandApi.notify(`Loaded ${slot.label}`));
              }
            });
          }
        }
        if (state.overlay === "rewindConfirm" && ev.key.return && state.pendingRewindEventId) {
          void engine.timeline.rewind(state.pendingRewindEventId).then(() => {
            dispatch({ type: "setPendingRewind", eventId: undefined });
            dispatch({ type: "setOverlay", overlay: undefined });
            commandApi.notify("Rewound branch");
          });
        }
        return;
      }

      if (state.choices) {
        if (ev.key.upArrow || action === "choiceUp") {
          dispatch({
            type: "setChoices",
            choices: { ...state.choices, selected: Math.max(0, state.choices.selected - 1) },
          });
          return;
        }
        if (ev.key.downArrow || action === "choiceDown") {
          dispatch({
            type: "setChoices",
            choices: {
              ...state.choices,
              selected: Math.min(state.choices.choices.length - 1, state.choices.selected + 1),
            },
          });
          return;
        }
        const pick = choiceIndexFromKey(ev.name, ev.input);
        const digitsPickChoices =
          inputDraftRef.current.length === 0 && state.focus !== "input";
        if (
          pick !== undefined &&
          digitsPickChoices &&
          pick < state.choices.choices.length
        ) {
          void submit("", state.choices.choices[pick]!.id);
          return;
        }
        if (ev.key.return || action === "submit") {
          const choice = state.choices.choices[state.choices.selected];
          if (choice) void submit("", choice.id);
          return;
        }
      }

      if (action === "commandPalette") {
        dispatch({ type: "setPalette", open: true, query: "", index: 0 });
        return;
      }
      if (action === "toggleMouse") {
        const next = !state.mouseCapture;
        commandApi.setMouseCapture(next);
        commandApi.notify(next ? "Mouse on" : "Mouse off");
        return;
      }

      const inputFocused = state.focus === "input" && !state.choices;
      if (inputFocused) {
        if (ev.key.tab && !ev.shift) {
          if (applyTabAutocomplete(state, dispatch, nameHints, config.customCommands)) return;
          dispatch({ type: "setAutocomplete", open: true });
          return;
        }
        if (ev.input === "/" && inputDraftRef.current.length === 0) {
          dispatch({ type: "setPalette", open: true, query: "", index: 0 });
          return;
        }
        if (ev.key.return || action === "submit") {
          void submitLine(inputDraftRef.current);
          return;
        }
        if (ev.key.upArrow) {
          applyHistory(-1);
          return;
        }
        if (ev.key.downArrow) {
          applyHistory(1);
          return;
        }
        if (ev.key.backspace) {
          const { text, cursor } = deleteGraphemeBefore(
            inputDraftRef.current,
            inputCursorRef.current,
          );
          setInputDraft(text, cursor);
          return;
        }
        if (ev.key.delete) {
          setInputDraft(
            deleteGraphemeAfter(inputDraftRef.current, inputCursorRef.current),
            inputCursorRef.current,
          );
          return;
        }
        if (ev.key.leftArrow) {
          setInputDraft(inputDraftRef.current, Math.max(0, inputCursorRef.current - 1));
          return;
        }
        if (ev.key.rightArrow) {
          setInputDraft(
            inputDraftRef.current,
            Math.min(graphemeCount(inputDraftRef.current), inputCursorRef.current + 1),
          );
          return;
        }
        if (!ev.ctrl && ev.input) {
          const insert = ev.input;
          const next = insertAtGrapheme(inputDraftRef.current, inputCursorRef.current, insert);
          setInputDraft(next, inputCursorRef.current + graphemeCount(insert));
          if (next.trimStart().startsWith(":") || nameHints.length > 0) {
            dispatch({ type: "setAutocomplete", open: true });
          }
          return;
        }
      }

      if (action === "focusNext") {
        if (mode === "single-column" && state.focus === "transcript") {
          dispatch({ type: "setOverlay", overlay: "sidePanel" });
          dispatch({ type: "setFocus", focus: "sidePanel" });
        } else {
          dispatch({
            type: "setFocus",
            focus: state.focus === "transcript" ? "sidePanel" : "transcript",
          });
        }
        return;
      }
      if (action === "scrollPageUp") {
        if (s.focus === "sidePanel") dispatch({ type: "scrollSide", delta: scrollPage });
        else dispatch({ type: "scrollTranscript", delta: scrollPage });
        return;
      }
      if (action === "scrollPageDown") {
        if (s.focus === "sidePanel") dispatch({ type: "scrollSide", delta: -scrollPage });
        else dispatch({ type: "scrollTranscript", delta: -scrollPage });
        return;
      }
      if (action === "help") dispatch({ type: "setOverlay", overlay: "help" });
      if (action === "eventLog") dispatch({ type: "setOverlay", overlay: "eventLog" });
      if (action === "timeline") dispatch({ type: "setOverlay", overlay: "timeline" });
      if (action === "explain") dispatch({ type: "setOverlay", overlay: "explain" });
      if (action === "inspector") dispatch({ type: "setOverlay", overlay: "inspector" });
      if (action === "save") {
        void engine.timeline.save().then((s) => commandApi.notify(`Saved ${s.label}`));
      }
      if (action === "load") dispatch({ type: "setOverlay", overlay: "loadSlots" });
      if (action === "rewindTurn") {
        void engine.timeline.events({ limit: 80 }).then((events) => {
          const target = events.at(-2)?.id;
          if (!target) {
            commandApi.notify("No prior turn to rewind", "warn");
            return;
          }
          dispatch({ type: "setPendingRewind", eventId: target });
          dispatch({ type: "setOverlay", overlay: "rewindConfirm" });
        });
      }
    },
    { isActive: true, onMouse: handleMouse },
  );

  async function submitLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith(":")) {
      const result = await runCommandLine(trimmed, commandApi, config.customCommands);
      if (result === "quit") void onQuit();
      setInputDraft("", 0);
      return;
    }
    dispatch({ type: "pushHistory", line: trimmed });
    setInputDraft("", 0);
    await submit(trimmed);
  }

  function applyHistory(delta: number) {
    const hist = state.inputHistory;
    if (hist.length === 0) return;
    const idx =
      state.historyIndex === undefined
        ? delta < 0
          ? hist.length - 1
          : undefined
        : state.historyIndex + delta;
    if (idx === undefined || idx < 0 || idx >= hist.length) return;
    const line = hist[idx]!;
    setInputDraft(line, graphemeCount(line));
    dispatch({ type: "setHistoryIndex", index: idx });
  }

  const layoutProps: LayoutProps = {
    viewer,
    actor,
    engine,
    focus: state.focus,
    overlay: state.overlay,
    hasScene: Boolean(state.sceneId),
    noSceneHint: "No active scene — use :help or :commands to explore.",
  };

  return (
    <RunnerProvider onQuit={() => void onQuit()}>
      <Box flexDirection="column">
        <Layout {...layoutProps} />
        {state.overlay === "help" ? <HelpOverlay /> : null}
        {state.overlay === "eventLog" ? <EventLog /> : null}
        {state.overlay === "timeline" ? <TimelineBrowser selectedBranch={timelineIdx} /> : null}
        {state.overlay === "explain" ? <ExplainView /> : null}
        {state.overlay === "inspector" ? <Inspector /> : null}
        {state.overlay === "loadSlots" ? <LoadSlots selected={loadIdx} /> : null}
        {state.overlay === "rewindConfirm" ? (
          <Overlay title="Rewind confirm (Ctrl+Z)">
            <Text>Rewind to event {state.pendingRewindEventId}? Enter confirm · Esc cancel</Text>
          </Overlay>
        ) : null}
        {state.overlay === "sidePanel" && mode !== "two-column" ? (
          <SidePanel width={columns} />
        ) : null}
        <CommandPalette />
        <PromptDialog />
        <EntityActionMenu />
      </Box>
    </RunnerProvider>
  );
}
