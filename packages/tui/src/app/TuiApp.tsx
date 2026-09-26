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
import { isCompleteControlSequence } from "../ink/vendor/input-parser.js";
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
import { createHostI18n, galleryNoticeToast } from "@animae/host";
import {
  deleteGraphemeAfter,
  deleteGraphemeBefore,
  insertAtGrapheme,
} from "../utils/display-width.ts";
import { graphemeCount } from "../utils/grapheme.ts";
import { transcriptPageStep } from "../utils/transcript-limits.ts";
import { OverlaySlotProvider } from "../context/overlay-slot-context.tsx";
import { useMouseDispatch } from "../context/mouse-context.tsx";
import { MouseCaptureBridge } from "./MouseCaptureBridge.tsx";
import { ActionRunnerProvider } from "../context/action-runner-context.tsx";
import { CommandPalette } from "../components/CommandPalette.tsx";
import { PromptDialog, handlePromptKey } from "../components/PromptDialog.tsx";
import { EntityActionMenu } from "../components/EntityActionMenu.tsx";
import { useActionRunner } from "../context/action-runner-context.tsx";
import { applyTabAutocomplete } from "../components/AutocompletePopup.tsx";
import { InputDraftProvider, useInputDraftActions } from "../context/input-draft-context.tsx";
import { buildPaletteEntries } from "../utils/action-list.ts";
import { TuiI18nProvider, useTuiI18n } from "../i18n/context.tsx";
import { GalleryPanel } from "../components/GalleryPanel.tsx";
import { localizeError, type FormatParams } from "@animae/i18n";

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
      resolveFreeInput: props.resolveFreeInput,
      galleryPresentation: props.galleryPresentation,
      openFile: props.openFile,
      galleryCapture: props.galleryCapture,
      galleryNotices: props.galleryNotices,
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
      props.resolveFreeInput,
      props.galleryPresentation,
      props.openFile,
      props.galleryCapture,
      props.galleryNotices,
    ],
  );

  const Layout = (props.layout ?? defaultLayout) as ComponentType<LayoutProps>;

  return (
    <EngineProvider value={{ engine: props.engine, viewer, actor, displayName: props.displayName }}>
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
                noSceneHint={props.noSceneHint}
                initialUiLocale={props.uiLocale}
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
  noSceneHint,
  initialUiLocale,
}: {
  Layout: ComponentType<LayoutProps>;
  exitOnCtrlC: boolean;
  nameHints: string[];
  noSceneHint?: string;
  initialUiLocale?: string;
}) {
  const { config } = useAppState();
  const dispatchMouse = useMouseDispatch();
  return (
    <TuiI18nProvider initialLocale={initialUiLocale}>
      <ActionRunnerProvider actions={config.actions} entityActions={config.entityActions}>
        <InputDraftProvider>
          <TuiShellInner
            Layout={Layout}
            exitOnCtrlC={exitOnCtrlC}
            nameHints={nameHints}
            noSceneHint={noSceneHint}
            dispatchMouse={dispatchMouse}
          />
        </InputDraftProvider>
      </ActionRunnerProvider>
    </TuiI18nProvider>
  );
}

function TuiShellInner({
  Layout,
  exitOnCtrlC,
  nameHints,
  noSceneHint,
  dispatchMouse,
}: {
  Layout: ComponentType<LayoutProps>;
  exitOnCtrlC: boolean;
  nameHints: string[];
  noSceneHint?: string;
  dispatchMouse: ReturnType<typeof useMouseDispatch>;
}) {
  const { t, has, setLocale: setUiLocale, locale: uiLocale } = useTuiI18n();
  const app = useApp();
  const { engine, viewer, actor } = useEngineContext();
  const { state, dispatch, commandApi, config } = useAppState();
  const { submit } = useTurn();
  const { keymap } = useKeymapContext();
  const { columns, rows } = useWindowSize();
  const theme = useTheme();
  const mode = selectLayoutMode(columns, rows);
  const scrollPage = transcriptPageStep(rows);

  // Wheel turns are handled by the regions that scroll (the transcript and the side panel register as wheel
  // targets); everything else, clicks included, goes through the hit test.
  const handleMouse = useCallback((ev: SgrMouseEvent) => dispatchMouse(ev), [dispatchMouse]);
  const [timelineIdx, setTimelineIdx] = useState(0);
  const [loadIdx, setLoadIdx] = useState(0);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [galleryRevealed, setGalleryRevealed] = useState<Set<string>>(() => new Set());
  const [galleryDeletePending, setGalleryDeletePending] = useState(false);
  const [galleryTick, setGalleryTick] = useState(0);
  useEffect(() => {
    const hostT = createHostI18n(uiLocale);
    const tHost = (key: string, params?: Record<string, string | number>) =>
      hostT.t(key, params, { ns: "host" });
    const off = engine.gallery.subscribe((notice) => {
      if (notice.type === "changed") {
        setGalleryTick((n) => n + 1);
        return;
      }
      void galleryNoticeToast(notice, {
        locale: uiLocale,
        getItem: (id) => engine.gallery.get(id, { locale: uiLocale, includeUnavailable: true }),
        maskTitle: config.galleryNotices?.maskTitle,
        t: tHost,
      }).then((payload) => {
        if (payload) commandApi.notify(payload.text, payload.level);
        setGalleryTick((n) => n + 1);
      });
    });
    return off;
  }, [engine, uiLocale, config.galleryNotices, commandApi]);
  const { setDraft: setInputDraft, clearDraft, readDraft } = useInputDraftActions();
  const { completePrompt, actions, entityActions, actionContext, runAction, runEntityAction } =
    useActionRunner();
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const s = stateRef.current;
    if (s.overlay || s.paletteOpen || s.prompt || s.choices) return;
    dispatch({ type: "setFocus", focus: "input" });
  }, [columns, rows, dispatch]);

  const patchInputDraft = (value: string, cursor: number) => {
    setInputDraft(value, cursor);
  };
  const draftNow = () => readDraft();

  const syncAutocomplete = useCallback(
    (next: string) => {
      const s = stateRef.current;
      const want =
        (next.trimStart().startsWith(":") || nameHints.length > 0) &&
        s.focus === "input" &&
        !s.choices;
      if (want !== s.autocompleteOpen) {
        dispatch({ type: "setAutocomplete", open: want });
      }
    },
    [dispatch, nameHints.length],
  );

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
    process.on("SIGHUP", onSignal);
    return () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.off("SIGHUP", onSignal);
    };
  }, [onQuit]);

  const insertInputText = useCallback(
    (text: string) => {
      if (!text) return;
      const { draft, cursor } = draftNow();
      const next = insertAtGrapheme(draft, cursor, text);
      patchInputDraft(next, cursor + graphemeCount(text));
      syncAutocomplete(next);
    },
    [syncAutocomplete],
  );

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
          dispatch({ type: "setFocus", focus: "input" });
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
              { t, has },
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
                { ...commandApi, setUiLocale, t },
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
        // Let Esc/Tab/arrows reach overlay, choice menu, and input handlers while text catches up.
        const navThrough =
          ev.key.escape ||
          ev.key.tab ||
          ev.key.upArrow ||
          ev.key.downArrow ||
          ev.key.return;
        if ((s.focus !== "input" || s.choices) && !navThrough) {
          return;
        }
      }

      if (exitOnCtrlC && ev.ctrl && ev.name === "c") {
        void onQuit();
        return;
      }

      if (
        !s.overlay &&
        !s.paletteOpen &&
        ev.key.escape &&
        s.focus !== "input"
      ) {
        dispatch({ type: "setFocus", focus: "input" });
        return;
      }

      const action = matchKeyAction(keymap, ev.name, ev.input, {
        ctrl: ev.ctrl,
        shift: ev.shift,
        meta: ev.key.meta,
      });

      if (action === "commandPalette") {
        if (s.overlay) {
          dispatch({ type: "setOverlay", overlay: undefined });
          dispatch({ type: "setPendingRewind", eventId: undefined });
        }
        dispatch({ type: "setPalette", open: true, query: "", index: 0 });
        dispatch({ type: "setFocus", focus: "input" });
        return;
      }

      if (s.overlay) {
        if (action === "closeOverlay" || ev.key.escape) {
          dispatch({ type: "setOverlay", overlay: undefined });
          dispatch({ type: "setPendingRewind", eventId: undefined });
          dispatch({ type: "setFocus", focus: "input" });
          return;
        }
        if (s.overlay === "timeline") {
          if (ev.key.upArrow) setTimelineIdx((i) => Math.max(0, i - 1));
          if (ev.key.downArrow) setTimelineIdx((i) => i + 1);
          if (ev.key.return) {
            void engine.timeline.branches().then((bs) => {
              const name = bs[timelineIdx]?.name;
              if (name) void engine.timeline.switch(name);
            });
          }
        }
        if (s.overlay === "loadSlots") {
          if (ev.key.upArrow) setLoadIdx((i) => Math.max(0, i - 1));
          if (ev.key.downArrow) setLoadIdx((i) => i + 1);
          if (ev.key.return) {
            void engine.timeline.saves().then((saves) => {
              const slot = saves[loadIdx];
              if (slot) {
                void engine.timeline
                  .load(slot)
                  .then(() => commandApi.notify(t("command.loaded", { label: slot.label })));
              }
            });
          }
        }
        if (s.overlay === "gallery") {
          const bump = () => setGalleryTick((n) => n + 1);
          const fail = (err: unknown) =>
            commandApi.notify(localizeError(err, (key, params) => t(key, params as FormatParams)), "warn");
          if (ev.key.upArrow) setGalleryIdx((i) => Math.max(0, i - 1));
          if (ev.key.downArrow) setGalleryIdx((i) => i + 1);
          if (ev.key.return) {
            void engine.gallery.list({ locale: uiLocale }).then((items) => {
              const item = items[galleryIdx];
              if (!item) return;
              const pres = config.galleryPresentation?.(item);
              if (pres?.blur && !galleryRevealed.has(item.id)) {
                setGalleryRevealed((s) => new Set(s).add(item.id));
              }
            });
          }
          if (ev.name === "c") {
            const capture = config.galleryCapture ?? ((_, req) => engine.gallery.capture(req));
            void capture(commandApi, undefined).then(bump).catch(fail);
          }
          if (ev.name === "r") {
            void engine.gallery.list({ locale: uiLocale }).then((items) => {
              const item = items[galleryIdx];
              if (item) void engine.gallery.render(item.id).then(bump).catch(fail);
            });
          }
          if (ev.name === "x") {
            const job = engine.gallery.jobs().find((j) => j.state !== "done" && j.state !== "failed");
            if (job) void engine.gallery.cancel(job.id).then(bump).catch(fail);
          }
          if (ev.name === "o") {
            void engine.gallery.list({ locale: uiLocale }).then(async (items) => {
              const item = items[galleryIdx];
              if (!item) return;
              const img = await engine.gallery.image(item.id);
              if (!img) {
                commandApi.notify(t("gallery.no_image"), "warn");
                return;
              }
              const open = commandApi.openFile;
              if (open) await open(img.ref.path);
              else commandApi.notify(img.ref.path);
            });
          }
          if (ev.name === "p") {
            void engine.gallery.list({ locale: uiLocale }).then((items) => {
              const item = items[galleryIdx];
              if (item?.kind === "captured") {
                void engine.gallery.pin(item.id, !item.pinned).then(bump).catch(fail);
              }
            });
          }
          if (ev.name === "d") {
            void engine.gallery.list({ locale: uiLocale }).then((items) => {
              const item = items[galleryIdx];
              if (!item || item.kind !== "captured") return;
              if (!galleryDeletePending) {
                setGalleryDeletePending(true);
                commandApi.notify(t("gallery.delete_confirm"), "warn");
                return;
              }
              setGalleryDeletePending(false);
              void engine.gallery.remove(item.id).then(bump).catch(fail);
            });
          }
          if (ev.key.escape && galleryDeletePending) {
            setGalleryDeletePending(false);
          }
        }
        if (s.overlay === "rewindConfirm" && ev.key.return && s.pendingRewindEventId) {
          void engine.timeline.rewind(s.pendingRewindEventId).then(() => {
            dispatch({ type: "setPendingRewind", eventId: undefined });
            dispatch({ type: "setOverlay", overlay: undefined });
            commandApi.notify(t("rewind.rewound_branch"));
          });
        }
        return;
      }

      if (s.choices) {
        if (ev.key.escape) {
          if (s.focus === "input") {
            dispatch({ type: "setChoices", choices: undefined });
            return;
          }
          dispatch({ type: "setFocus", focus: "input" });
          return;
        }
        if (ev.key.tab && !ev.shift && s.focus !== "input") {
          dispatch({ type: "setFocus", focus: "input" });
          return;
        }
        if (ev.key.upArrow || action === "choiceUp") {
          dispatch({
            type: "setChoices",
            choices: { ...s.choices, selected: Math.max(0, s.choices.selected - 1) },
          });
          return;
        }
        if (ev.key.downArrow || action === "choiceDown") {
          dispatch({
            type: "setChoices",
            choices: {
              ...s.choices,
              selected: Math.min(s.choices.choices.length - 1, s.choices.selected + 1),
            },
          });
          return;
        }
        const pick = choiceIndexFromKey(ev.name, ev.input);
        const digitsPickChoices = draftNow().draft.length === 0 && s.focus !== "input";
        if (
          pick !== undefined &&
          digitsPickChoices &&
          pick < s.choices.choices.length
        ) {
          void submit("", s.choices.choices[pick]!.id);
          return;
        }
        if (ev.key.return || action === "submit") {
          const choice = s.choices.choices[s.choices.selected];
          if (choice) void submit("", choice.id);
          return;
        }
      }

      if (action === "toggleMouse") {
        const next = !s.mouseCapture;
        commandApi.setMouseCapture(next);
        commandApi.notify(next ? t("command.mouse_on") : t("command.mouse_off"));
        return;
      }

      const inputFocused = s.focus === "input" && !s.overlay;
      if (inputFocused) {
        const draftNowLine = draftNow().draft.trim();
        const urgentCommand =
          draftNowLine.startsWith(":") &&
          /^(?:quit|leave|help)\b/i.test(draftNowLine.slice(1));
        if (
          s.pending &&
          !urgentCommand &&
          (ev.key.return ||
            (ev.input && !ev.key.escape && !ev.ctrl && !ev.key.ctrl))
        ) {
          return;
        }
        if (ev.key.escape) {
          if (s.autocompleteOpen) {
            dispatch({ type: "setAutocomplete", open: false });
            return;
          }
          dispatch({ type: "setFocus", focus: "input" });
          return;
        }
        if (ev.key.tab && !ev.shift) {
          if (
            applyTabAutocomplete(
              { ...s, inputDraft: draftNow().draft, inputCursor: draftNow().cursor },
              dispatch,
              nameHints,
              config.customCommands,
              patchInputDraft,
              draftNow().draft,
            )
          )
            return;
          dispatch({ type: "setAutocomplete", open: true });
          return;
        }
        if (ev.input === "/" && draftNow().draft.length === 0) {
          dispatch({ type: "setPalette", open: true, query: "", index: 0 });
          return;
        }
        if (ev.key.return || action === "submit") {
          void submitLine(draftNow().draft);
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
          const { draft, cursor } = draftNow();
          const deleted = deleteGraphemeBefore(draft, cursor);
          patchInputDraft(deleted.text, deleted.cursor);
          syncAutocomplete(deleted.text);
          return;
        }
        if (ev.key.delete) {
          const { draft, cursor } = draftNow();
          const next = deleteGraphemeAfter(draft, cursor);
          patchInputDraft(next, cursor);
          syncAutocomplete(next);
          return;
        }
        if (ev.key.leftArrow) {
          const { draft, cursor } = draftNow();
          patchInputDraft(draft, Math.max(0, cursor - 1));
          return;
        }
        if (ev.key.rightArrow) {
          const { draft, cursor } = draftNow();
          patchInputDraft(draft, Math.min(graphemeCount(draft), cursor + 1));
          return;
        }
        const insertAction = matchKeyAction(keymap, ev.name, ev.input, {
          ctrl: ev.ctrl,
          shift: ev.shift,
          meta: ev.key.meta,
        });
        const isPrintableInput =
          ev.input &&
          !ev.key.return &&
          !ev.key.tab &&
          !ev.key.escape &&
          !isCompleteControlSequence(ev.input) &&
          !insertAction;
        if (!ev.ctrl && isPrintableInput) {
          const insert = ev.input;
          const { draft, cursor } = draftNow();
          const next = insertAtGrapheme(draft, cursor, insert);
          patchInputDraft(next, cursor + graphemeCount(insert));
          syncAutocomplete(next);
          return;
        }
      }

      if (action === "focusNext") {
        if (mode === "single-column" && s.focus === "transcript") {
          dispatch({ type: "setOverlay", overlay: "sidePanel" });
          dispatch({ type: "setFocus", focus: "sidePanel" });
        } else {
          dispatch({
            type: "setFocus",
            focus: s.focus === "transcript" ? "sidePanel" : "transcript",
          });
        }
        return;
      }
      if (action === "scrollPageUp") {
        if (s.focus === "sidePanel") dispatch({ type: "scrollSide", delta: -scrollPage });
        else dispatch({ type: "scrollTranscript", delta: scrollPage });
        return;
      }
      if (action === "scrollPageDown") {
        if (s.focus === "sidePanel") dispatch({ type: "scrollSide", delta: scrollPage });
        else dispatch({ type: "scrollTranscript", delta: -scrollPage });
        return;
      }
      if (action === "help") dispatch({ type: "setOverlay", overlay: "help" });
      if (action === "eventLog") dispatch({ type: "setOverlay", overlay: "eventLog" });
      if (action === "timeline") dispatch({ type: "setOverlay", overlay: "timeline" });
      if (action === "explain") dispatch({ type: "setOverlay", overlay: "explain" });
      if (action === "inspector") dispatch({ type: "setOverlay", overlay: "inspector" });
      if (action === "save") {
        void engine.timeline
          .save()
          .then((s) =>
            commandApi.notify(t("command.saved", { label: s.label, eventId: s.eventId })),
          );
      }
      if (action === "load") dispatch({ type: "setOverlay", overlay: "loadSlots" });
      if (action === "rewindTurn") {
        void engine.timeline.events({ limit: 80 }).then((events) => {
          const target = events.at(-2)?.id;
          if (!target) {
            commandApi.notify(t("rewind.no_prior_turn"), "warn");
            return;
          }
          dispatch({ type: "setPendingRewind", eventId: target });
          dispatch({ type: "setOverlay", overlay: "rewindConfirm" });
        });
      }
    },
    {
      isActive: true,
      onMouse: handleMouse,
      onPaste: (text) => {
        const s = stateRef.current;
        if (s.prompt || s.paletteOpen || s.overlay) return;
        if (s.focus !== "input") return;
        insertInputText(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
      },
    },
  );

  async function submitLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith(":")) {
      const result = await runCommandLine(
        trimmed,
        { ...commandApi, setUiLocale, t },
        config.customCommands,
      );
      if (result === "quit") void onQuit();
      clearDraft();
      dispatch({ type: "setAutocomplete", open: false });
      return;
    }
    dispatch({ type: "pushHistory", line: trimmed });
    clearDraft();
    dispatch({ type: "setAutocomplete", open: false });
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
    patchInputDraft(line, graphemeCount(line));
    dispatch({ type: "setHistoryIndex", index: idx });
  }

  const layoutProps: LayoutProps = {
    viewer,
    actor,
    engine,
    focus: state.focus,
    overlay: state.overlay,
    hasScene: Boolean(state.sceneId),
    noSceneHint: noSceneHint ?? t("command.no_scene"),
  };

  const sidePanelOverlay = state.overlay === "sidePanel" && mode !== "two-column";
  // `sidePanel` is not an overlay in the two-column layout: the panel is already on screen.
  const overlayOpen =
    (state.overlay !== undefined && (state.overlay !== "sidePanel" || sidePanelOverlay)) ||
    state.paletteOpen ||
    state.prompt !== undefined ||
    (state.entityMenuOpen && state.focusTarget !== undefined);
  const overlays = (
    <>
      {state.overlay === "help" ? <HelpOverlay /> : null}
      {state.overlay === "eventLog" ? <EventLog /> : null}
      {state.overlay === "timeline" ? <TimelineBrowser selectedBranch={timelineIdx} /> : null}
      {state.overlay === "explain" ? <ExplainView /> : null}
      {state.overlay === "inspector" ? <Inspector /> : null}
      {state.overlay === "loadSlots" ? <LoadSlots selected={loadIdx} /> : null}
      {state.overlay === "gallery" ? (
        <GalleryPanel
          selected={galleryIdx}
          revealed={galleryRevealed}
          onToggleReveal={(id) => setGalleryRevealed((s) => new Set(s).add(id))}
          presentation={config.galleryPresentation}
          locale={uiLocale}
          onRefresh={() => setGalleryTick((n) => n + 1)}
        />
      ) : null}
      {state.overlay === "rewindConfirm" ? (
        <Overlay title={t("rewind.confirm_title")}>
          <Text>
            {t("rewind.confirm_body", { eventId: state.pendingRewindEventId ?? "" })}
          </Text>
        </Overlay>
      ) : null}
      {sidePanelOverlay ? <SidePanel width={columns} fill /> : null}
      <CommandPalette />
      <PromptDialog />
      <EntityActionMenu />
    </>
  );
  // The default layout shows modals in its main region (the frame stays as tall as the terminal). A custom
  // layout does not know about the slot, so its modals still follow it.
  const inLayout = Layout === defaultLayout;

  return (
    <RunnerProvider onQuit={() => void onQuit()}>
      <Box flexDirection="column">
        <OverlaySlotProvider value={inLayout && overlayOpen ? overlays : null}>
          <Layout {...layoutProps} />
        </OverlaySlotProvider>
        {inLayout ? null : overlays}
      </Box>
    </RunnerProvider>
  );
}
