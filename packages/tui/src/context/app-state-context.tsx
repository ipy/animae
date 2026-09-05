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
import { trimTranscript } from "../utils/transcript-limits.ts";
import type { CueRenderer, Theme } from "../types.ts";
import type { Engine, SceneId, TurnId, Viewer } from "../types.ts";

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
  lastRoute: "s1" | "s2" | undefined;
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
  | { type: "systemLine"; text: string }
  | { type: "setChoices"; choices: ChoiceState | undefined }
  | { type: "setSpeaking"; speaking: boolean }
  | { type: "setPending"; pending: boolean }
  | { type: "setLastRoute"; route: "s1" | "s2" | undefined }
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
  | { type: "setAutocomplete"; open: boolean; index?: number }
  | { type: "setPrompt"; prompt: PromptState | undefined }
  | { type: "patchPrompt"; patch: Partial<PromptState> }
  | { type: "setEntityMenu"; open: boolean }
  | { type: "togglePanelCollapsed"; panelId: string }
  | { type: "setMouseCapture"; on: boolean };

function reducer(state: AppState, action: AppStateAction): AppState {
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
    case "systemLine":
      return {
        ...state,
        transcript: trimTranscript([
          ...state.transcript,
          {
            id: `sys_${state.transcript.length}`,
            kind: "system",
            text: action.text,
            complete: true,
          },
        ]),
      };
    case "setChoices":
      return { ...state, choices: action.choices };
    case "setSpeaking":
      return { ...state, speaking: action.speaking };
    case "setPending":
      return { ...state, pending: action.pending };
    case "setLastRoute":
      return { ...state, lastRoute: action.route };
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
        transcriptScroll: Math.max(0, state.transcriptScroll + action.delta),
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
  onSceneEnd?: (report: unknown) => void;
  header?: ComponentType<LayoutProps>;
  footer?: ComponentType<LayoutProps>;
  nameHints: string[];
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
  const [state, dispatch] = useReducer(reducer, initialAppState(), (base) => ({
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

  const commandApi: CommandApi = useMemo(
    () => ({
      engine,
      viewer,
      actor,
      sceneId: () => sceneIdRef.current,
      startScene: async (s) => {
        const id = await engine.scene.start(s);
        dispatch({ type: "setScene", sceneId: id });
        return id;
      },
      endScene: async () => {
        if (!state.sceneId) return;
        const report = await engine.scene.end(state.sceneId);
        config.onSceneEnd?.(report);
        dispatch({ type: "setScene", sceneId: undefined });
        dispatch({ type: "setChoices", choices: undefined });
      },
      notify,
      openOverlay,
      closeOverlay,
      setMouseCapture,
    }),
    [engine, viewer, actor, state.sceneId, notify, openOverlay, closeOverlay, setMouseCapture, config],
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
