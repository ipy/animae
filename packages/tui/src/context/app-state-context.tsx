import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ComponentType,
  type Dispatch,
  type ReactNode,
} from "react";
import type {
  ChoiceState,
  CommandApi,
  CustomCommand,
  LayoutProps,
  OverlayId,
  SidePanelSection,
  TranscriptEntry,
  LayoutFocus,
  PromptState,
} from "../types.ts";
import { mirrorPtyTurnPending } from "../input/pty-draft-mirror.ts";
import { trimTranscript } from "../utils/transcript-limits.ts";
import type { CueRenderer, Theme } from "../types.ts";
import { AnimaeError } from "@animae/engine";
import { localizeError } from "@animae/i18n";
import type { Engine, SceneId, TurnId, Viewer } from "../types.ts";

/** How the last turn was actually served (from `route.decided`), for the footer. */
export interface LastRoute {
  appraise: "llm" | "rule";
  render: "llm" | "rule";
  /** S2 tier that rendered the turn (`render` is `llm`). */
  tier?: string;
}

export interface AppState {
  sceneId: SceneId | undefined;
  focus: LayoutFocus;
  overlay: OverlayId | undefined;
  transcript: TranscriptEntry[];
  choices: ChoiceState | undefined;
  inputHistory: string[];
  historyIndex: number | undefined;
  speaking: boolean;
  pending: boolean;
  lastRoute: LastRoute | undefined;
  /** Bumped when the runtime mode (or a queued change) changed, so views re-read `engine.runtime`. */
  modeTick: number;
  lastTurnId: TurnId | undefined;
  lastExplainTurnId: TurnId | undefined;
  transcriptScroll: number;
  sidePanelScroll: number;
  typewriterActive: boolean;
  typewriterSkip: number;
  pendingRewindEventId: string | undefined;
  filterEventKinds: string[] | undefined;
  turnError: string | undefined;
  inputDraft: string;
  inputCursor: number;
  focusTarget: string | undefined;
  paletteOpen: boolean;
  paletteQuery: string;
  paletteIndex: number;
  autocompleteOpen: boolean;
  autocompleteIndex: number;
  prompt: PromptState | undefined;
  entityMenuOpen: boolean;
  collapsedPanels: Record<string, boolean>;
  mouseCapture: boolean;
}

export type AppStateAction =
  | { type: "setScene"; sceneId: SceneId | undefined }
  | { type: "setFocus"; focus: LayoutFocus }
  | { type: "setOverlay"; overlay: OverlayId | undefined }
  | { type: "appendTranscript"; entry: TranscriptEntry }
  | { type: "patchTranscript"; id: string; patch: Partial<TranscriptEntry> }
  | { type: "removeTranscript"; ids: readonly string[] }
  | { type: "systemLine"; text: string }
  | { type: "setChoices"; choices: ChoiceState | undefined }
  /** Moves the highlighted choice relative to the state the reducer holds (key repeats must all count). */
  | { type: "moveChoice"; delta: number }
  | { type: "setSpeaking"; speaking: boolean }
  | { type: "setPending"; pending: boolean }
  | { type: "setLastRoute"; route: LastRoute | undefined }
  | { type: "bumpMode" }
  | { type: "setLastTurnId"; turnId: TurnId | undefined }
  | { type: "pushHistory"; line: string }
  | { type: "setHistoryIndex"; index: number | undefined }
  | { type: "scrollTranscript"; delta: number }
  | { type: "scrollTranscriptTail" }
  | { type: "scrollSide"; delta: number }
  | { type: "setTypewriterActive"; active: boolean }
  | { type: "setPendingRewind"; eventId: string | undefined }
  | { type: "setEventFilter"; kinds: string[] | undefined }
  | { type: "skipTypewriter" }
  | { type: "setTurnError"; error: string | undefined }
  | { type: "setInputDraft"; value: string; cursor: number }
  | { type: "setFocusTarget"; target: string | undefined }
  | { type: "setPalette"; open: boolean; query?: string; index?: number }
  /**
   * Edits of the open palette are relative to the state the reducer holds, not to the one the last render saw: keys
   * that arrive in the same tick (a key repeat, a paste) must all count.
   */
  | { type: "paletteInsert"; text: string }
  | { type: "paletteBackspace" }
  | { type: "paletteMove"; delta: number; max?: number }
  | { type: "setAutocomplete"; open: boolean; index?: number }
  | { type: "setPrompt"; prompt: PromptState | undefined }
  | { type: "patchPrompt"; patch: Partial<PromptState> }
  | { type: "setEntityMenu"; open: boolean }
  | { type: "togglePanelCollapsed"; panelId: string }
  | { type: "setMouseCapture"; on: boolean };

/** Ids must stay unique after the transcript is trimmed, so they come from a counter, not from the length. */
let systemLineSeq = 0;

/**
 * A system message becomes one transcript entry per line. The transcript scrolls by entries, so a long message
 * (a report, a list) can then be read piece by piece instead of being one block taller than the pane.
 */
function systemEntries(text: string): TranscriptEntry[] {
  return text.split("\n").map((line) => ({
    id: `sys_${++systemLineSeq}`,
    kind: "system" as const,
    // An empty Text takes no row; a space keeps blank lines (paragraph breaks) in place.
    text: line === "" ? " " : line,
    complete: true,
  }));
}

/** @internal exported for tests */
export function appStateReducer(state: AppState, action: AppStateAction): AppState {
  switch (action.type) {
    case "setScene":
      return { ...state, sceneId: action.sceneId };
    case "setFocus":
      return { ...state, focus: action.focus };
    case "setOverlay":
      return { ...state, overlay: action.overlay };
    case "appendTranscript":
      return {
        ...state,
        transcript: trimTranscript([...state.transcript, action.entry]),
      };
    case "patchTranscript":
      return {
        ...state,
        transcript: state.transcript.map((e) =>
          e.id === action.id ? { ...e, ...action.patch } : e,
        ),
      };
    case "removeTranscript": {
      if (action.ids.length === 0) return state;
      const drop = new Set(action.ids);
      const transcript = state.transcript.filter((e) => !drop.has(e.id));
      return {
        ...state,
        transcript,
        // The window may now end earlier than the scroll offset assumed.
        transcriptScroll: Math.min(state.transcriptScroll, Math.max(0, transcript.length - 1)),
      };
    }
    case "systemLine":
      return {
        ...state,
        transcript: trimTranscript([...state.transcript, ...systemEntries(action.text)]),
      };
    case "setChoices":
      return { ...state, choices: action.choices };
    case "moveChoice": {
      if (!state.choices) return state;
      const selected = Math.min(state.choices.choices.length - 1, Math.max(0, state.choices.selected + action.delta));
      return { ...state, choices: { ...state.choices, selected } };
    }
    case "setSpeaking":
      return { ...state, speaking: action.speaking };
    case "setPending":
      mirrorPtyTurnPending(action.pending);
      return { ...state, pending: action.pending };
    case "setLastRoute":
      return { ...state, lastRoute: action.route };
    case "bumpMode":
      return { ...state, modeTick: state.modeTick + 1 };
    case "setLastTurnId":
      return { ...state, lastTurnId: action.turnId, lastExplainTurnId: action.turnId };
    case "pushHistory":
      return {
        ...state,
        inputHistory: [...state.inputHistory.filter((h) => h !== action.line), action.line],
        historyIndex: undefined,
      };
    case "setHistoryIndex":
      return { ...state, historyIndex: action.index };
    case "scrollTranscript":
      return {
        ...state,
        // Never past the oldest entry: scrolling further would only show an empty pane.
        transcriptScroll: Math.min(
          Math.max(0, state.transcript.length - 1),
          Math.max(0, state.transcriptScroll + action.delta),
        ),
      };
    case "scrollTranscriptTail":
      return { ...state, transcriptScroll: 0 };
    case "scrollSide":
      return { ...state, sidePanelScroll: Math.max(0, state.sidePanelScroll + action.delta) };
    case "setTypewriterActive":
      return { ...state, typewriterActive: action.active };
    case "setPendingRewind":
      return { ...state, pendingRewindEventId: action.eventId };
    case "setEventFilter":
      return { ...state, filterEventKinds: action.kinds };
    case "skipTypewriter":
      return { ...state, typewriterSkip: state.typewriterSkip + 1 };
    case "setTurnError":
      return { ...state, turnError: action.error };
    case "setInputDraft":
      return { ...state, inputDraft: action.value, inputCursor: action.cursor };
    case "setFocusTarget":
      return { ...state, focusTarget: action.target, entityMenuOpen: action.target ? state.entityMenuOpen : false };
    case "setPalette":
      return {
        ...state,
        paletteOpen: action.open,
        paletteQuery: action.query ?? (action.open ? state.paletteQuery : ""),
        paletteIndex: action.index ?? (action.open ? 0 : 0),
      };
    case "paletteInsert":
      return { ...state, paletteQuery: state.paletteQuery + action.text, paletteIndex: 0 };
    case "paletteBackspace":
      return { ...state, paletteQuery: state.paletteQuery.slice(0, -1), paletteIndex: 0 };
    case "paletteMove":
      return {
        ...state,
        paletteIndex: Math.min(action.max ?? Number.MAX_SAFE_INTEGER, Math.max(0, state.paletteIndex + action.delta)),
      };
    case "setAutocomplete":
      return {
        ...state,
        autocompleteOpen: action.open,
        autocompleteIndex: action.index ?? 0,
      };
    case "setPrompt":
      return { ...state, prompt: action.prompt };
    case "patchPrompt":
      return state.prompt ? { ...state, prompt: { ...state.prompt, ...action.patch } } : state;
    case "setEntityMenu":
      return { ...state, entityMenuOpen: action.open };
    case "togglePanelCollapsed":
      return {
        ...state,
        collapsedPanels: {
          ...state.collapsedPanels,
          [action.panelId]: !state.collapsedPanels[action.panelId],
        },
      };
    case "setMouseCapture":
      return { ...state, mouseCapture: action.on };
    default:
      return state;
  }
}

export function initialAppState(): AppState {
  return {
    sceneId: undefined,
    focus: "input",
    overlay: undefined,
    transcript: [],
    choices: undefined,
    inputHistory: [],
    historyIndex: undefined,
    speaking: false,
    pending: false,
    lastRoute: undefined,
    modeTick: 0,
    lastTurnId: undefined,
    lastExplainTurnId: undefined,
    transcriptScroll: 0,
    sidePanelScroll: 0,
    typewriterActive: false,
    typewriterSkip: 0,
    pendingRewindEventId: undefined,
    filterEventKinds: undefined,
    turnError: undefined,
    inputDraft: "",
    inputCursor: 0,
    focusTarget: undefined,
    paletteOpen: false,
    paletteQuery: "",
    paletteIndex: 0,
    autocompleteOpen: false,
    autocompleteIndex: 0,
    prompt: undefined,
    entityMenuOpen: false,
    collapsedPanels: {},
    mouseCapture: true,
  };
}

export interface AppConfig {
  cueRegistry: Map<string, CueRenderer>;
  customCommands: Record<string, CustomCommand>;
  panels: SidePanelSection[];
  actions: import("../types.ts").TuiAction[];
  entityActions: import("../types.ts").EntityTuiAction[];
  theme: Theme;
  onSceneEnd?: (report: unknown, api: CommandApi) => void | Promise<void>;
  header?: ComponentType<LayoutProps>;
  footer?: ComponentType<LayoutProps>;
  nameHints: string[];
  resolveFreeInput?: import("../types.ts").ResolveFreeInputFn;
  galleryPresentation?: import("../types.ts").GalleryPresentationFn;
  openFile?: (path: string) => void | Promise<void>;
  galleryCapture?: import("../types.ts").RunTuiOptions["galleryCapture"];
  galleryNotices?: import("../types.ts").RunTuiOptions["galleryNotices"];
}

interface AppStateContextValue {
  state: AppState;
  dispatch: Dispatch<AppStateAction>;
  config: AppConfig;
  commandApi: CommandApi;
}

const AppStateContext = createContext<AppStateContextValue | undefined>(undefined);

export function AppStateProvider({
  engine,
  viewer,
  actor,
  config: baseConfig,
  children,
  initialSceneId,
  initialMessage,
  header,
  footer,
}: {
  engine: Engine;
  viewer: Viewer;
  actor: string;
  config: AppConfig;
  children: ReactNode;
  initialSceneId?: SceneId;
  initialMessage?: string;
  header?: AppConfig["header"];
  footer?: AppConfig["footer"];
}) {
  const config = useMemo(
    () => ({ ...baseConfig, header, footer }),
    [baseConfig, header, footer],
  );
  const [state, dispatch] = useReducer(appStateReducer, initialAppState(), (base) => ({
    ...base,
    sceneId: initialSceneId,
    transcript: initialMessage
      ? [
          {
            id: "init",
            kind: "system" as const,
            text: initialMessage,
            complete: true,
          },
        ]
      : [],
  }));

  useEffect(() => {
    if (initialSceneId !== undefined) {
      dispatch({ type: "setScene", sceneId: initialSceneId });
    }
  }, [initialSceneId]);

  const sceneIdRef = useRef(state.sceneId);
  sceneIdRef.current = state.sceneId;

  const openOverlay = useCallback((name: OverlayId) => {
    dispatch({ type: "setOverlay", overlay: name });
  }, []);

  const closeOverlay = useCallback(() => {
    dispatch({ type: "setOverlay", overlay: undefined });
  }, []);

  const setMouseCapture = useCallback((on: boolean) => {
    dispatch({ type: "setMouseCapture", on });
  }, []);

  const notify = useCallback(
    (text: string, level?: "info" | "warn" | "error") => {
      const prefix = level === "warn" ? "⚠ " : level === "error" ? "✖ " : "";
      dispatch({ type: "systemLine", text: prefix + text });
    },
    [],
  );

  /**
   * The engine owns the scene: `timeline.load` / `rewind` / `switch` can replace or drop it behind the UI's back, so
   * re-read it instead of trusting the cached id (a stale id makes every later turn fail with `SCENE_INVALID`).
   * Engines without `scene.active` (test doubles) keep the cached value.
   */
  const syncLiveScene = useCallback((): SceneId | undefined => {
    const probe = engine.scene.active;
    if (typeof probe === "function") {
      const live = probe.call(engine.scene)?.id;
      if (live !== sceneIdRef.current) {
        sceneIdRef.current = live;
        // Callers include render-time action predicates, so never dispatch synchronously from here.
        queueMicrotask(() => dispatch({ type: "setScene", sceneId: live }));
      }
    }
    return sceneIdRef.current;
  }, [engine, dispatch]);

  const commandApi: CommandApi = useMemo(
    () => ({
      engine,
      viewer,
      actor,
      sceneId: syncLiveScene,
      startScene: async (s) => {
        const id = await engine.scene.start(s);
        dispatch({ type: "setScene", sceneId: id });
        return id;
      },
      endScene: async () => {
        const id = syncLiveScene();
        if (!id) return;
        try {
          const report = await engine.scene.end(id);
          await config.onSceneEnd?.(report, commandApi);
        } catch (err) {
          if (!(err instanceof AnimaeError && err.code === "SCENE_INVALID")) {
            notify(localizeError(err, (key) => key), "warn");
          }
        }
        dispatch({ type: "setScene", sceneId: undefined });
        dispatch({ type: "setChoices", choices: undefined });
        dispatch({ type: "setFocus", focus: "input" });
      },
      attachScene: (id) => {
        dispatch({ type: "setScene", sceneId: id });
      },
      notify,
      openOverlay,
      closeOverlay,
      setMouseCapture,
      setTurnPending: (pending: boolean) => {
        dispatch({ type: "setPending", pending });
      },
      openFile: config.openFile,
    }),
    [engine, viewer, actor, notify, openOverlay, closeOverlay, setMouseCapture, config, dispatch, syncLiveScene],
  );

  const value = useMemo(
    () => ({ state, dispatch, config, commandApi }),
    [state, dispatch, config, commandApi],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState requires AppStateProvider");
  return ctx;
}
