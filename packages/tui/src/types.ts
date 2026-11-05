import type { Engine, GalleryCaptureRequest, GalleryItemView, NarrationStyle, TurnChunk } from "@animae/engine";
import type { SceneId, TurnId, Viewer } from "@animae/engine";
import type { ReactNode, ComponentType } from "react";
import type { ThemePatch } from "./theme/schema.ts";
import type { ResolvableText } from "./utils/resolve-text.ts";

export type { Engine, NarrationStyle, TurnChunk, SceneId, TurnId, Viewer };
export type { ResolvableText } from "./utils/resolve-text.ts";

export type LayoutFocus = "transcript" | "sidePanel" | "input" | "choices";

export type OverlayId =
  | "help"
  | "eventLog"
  | "timeline"
  | "explain"
  | "inspector"
  | "mode"
  | "sidePanel"
  | "loadSlots"
  | "rewindConfirm"
  | string;

export interface CueCtx {
  speaker?: string;
  theme: Theme;
  visibleChars: number;
  totalChars: number;
}

export type CueRenderer = (
  cue: { type: string; args: Record<string, unknown>; at?: number },
  ctx: CueCtx,
) => ReactNode | null;

export interface ThemeColors {
  primary: string;
  npc: string;
  player: string;
  narration: string;
  warning: string;
  dim: string;
  border: string;
}

export type BorderStyle = "single" | "double" | "round" | "bold" | "none";

export interface Theme {
  colors: ThemeColors;
  border: BorderStyle;
  typewriter: { charsPerSecond: number; enabled: boolean };
  sidePanel: {
    widthPercent: number;
    show: Array<"participants" | "tracks" | "fields" | "anchor">;
  };
  bell: boolean;
}

export type KeyAction =
  | "submit"
  | "choiceUp"
  | "choiceDown"
  | "choicePick"
  | "skipTypewriter"
  | "focusNext"
  | "scrollPageUp"
  | "scrollPageDown"
  | "commandPalette"
  | "toggleMouse"
  | "help"
  | "eventLog"
  | "timeline"
  | "explain"
  | "inspector"
  | "mode"
  | "save"
  | "load"
  | "rewindTurn"
  | "closeOverlay"
  | "quit";

export interface ActionContext {
  engine: Engine;
  viewer: Viewer;
  actor: string;
  sceneId: () => string | undefined;
  focusTarget?: string;
  commandApi: CommandApi;
}

export interface ActionArgField {
  id: string;
  label: ResolvableText;
  type: "text" | "select";
  options?: Array<{ value: string; label: ResolvableText }>;
  optional?: boolean;
}

export interface TuiAction {
  id: string;
  label: ResolvableText;
  hint?: ResolvableText;
  hotkey?: string;
  palette?: boolean;
  toolbar?: boolean;
  when?: (ctx: ActionContext) => boolean;
  args?: ActionArgField[];
  run: (ctx: ActionContext, args: Record<string, string>) => void | Promise<void>;
}

/** Per-entity actions (roster rows, list items). */
export interface EntityTuiAction {
  id: string;
  label: ResolvableText;
  hint?: ResolvableText;
  hotkey?: string;
  when?: (ctx: ActionContext, entityId: string) => boolean;
  args?: ActionArgField[];
  run: (ctx: ActionContext, entityId: string, args: Record<string, string>) => void | Promise<void>;
}

export interface PromptRequest {
  title: ResolvableText;
  fields: ActionArgField[];
  initial?: Record<string, string>;
}

export interface PromptState extends PromptRequest {
  values: Record<string, string>;
  fieldIndex: number;
}

export type Keymap = Partial<Record<KeyAction, string[]>>;

export interface CommandApi {
  engine: Engine;
  viewer: Viewer;
  actor: string;
  sceneId(): string | undefined;
  startScene(s: {
    location: string;
    participants: string[];
    fields?: string[];
  }): Promise<SceneId>;
  endScene(): Promise<void>;
  /** Sync UI scene id when the engine already has an active scene (e.g. startup race). */
  attachScene?(id: SceneId): void;
  notify(text: string, level?: "info" | "warn" | "error"): void;
  openOverlay(name: OverlayId): void;
  closeOverlay(): void;
  setMouseCapture(on: boolean): void;
  /** @internal TUI i18n — set UI catalog locale (`:lang`). */
  setUiLocale?(locale: string): void;
  /** Current UI locale tag (BCP-47). */
  locale?(): string;
  /** @internal TUI i18n — translate built-in chrome strings. */
  t?(key: string, params?: Record<string, string | number | boolean | null | undefined>): string;
  /** @internal Block input while a command-driven scene turn runs (PTY harness mirror). */
  setTurnPending?(pending: boolean): void;
  openFile?(path: string): void | Promise<void>;
}

export interface CustomCommand {
  description: ResolvableText;
  usage?: ResolvableText;
  run(args: string[], api: CommandApi): Promise<string | void>;
}

export interface SidePanelSection {
  id: string;
  title: ResolvableText;
  order?: number;
  render: ComponentType<{ viewer: Viewer; engine: Engine }>;
}

export interface LayoutProps {
  viewer: Viewer;
  actor: string;
  engine: Engine;
  focus: LayoutFocus;
  overlay: OverlayId | undefined;
  hasScene: boolean;
  noSceneHint: string;
}

export type ResolveFreeInputFn = (ctx: {
  text: string;
  choiceId?: string;
  api: CommandApi;
  focusTarget?: string;
  dispatch?: (prompt: string, options: Array<{ id: string; label: string }>) => void;
}) => Promise<"turn" | "handled">;

export interface RunTuiOptions {
  engine: Engine;
  /** Terminal mouse reporting (xterm SGR). `auto` when TTY; `NO_MOUSE=1` disables. */
  mouse?: boolean | "auto";
  /** Toolbar / palette / prompt actions registered by the host game. */
  actions?: TuiAction[];
  /** Context menu actions for `focusTarget` entity ids (e.g. roster members). */
  entityActions?: EntityTuiAction[];
  viewer?: Viewer;
  scene?:
    | { location: string; participants: string[]; fields?: string[] }
    | { sceneId: SceneId };
  actor?: string;
  layout?: ComponentType<LayoutProps>;
  theme?: Theme | ThemePatch | string;
  cueRenderers?: Record<string, CueRenderer>;
  keymap?: Partial<Keymap>;
  commands?: Record<string, CustomCommand>;
  panels?: SidePanelSection[];
  header?: ComponentType<LayoutProps>;
  footer?: ComponentType<LayoutProps>;
  onSceneEnd?: (report: unknown, api: CommandApi) => void | Promise<void>;
  initialMessage?: string;
  stdout?: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream;
  stderr?: NodeJS.WritableStream;
  /** @internal tests */
  exitOnCtrlC?: boolean;
  /** @internal dev harness — fired once after mount (before scene start completes). */
  onReady?: () => void;
  /** Autocomplete hints for member names / nicknames (host-provided). */
  nameHints?: string[];
  /**
   * Display name for a character id, used for transcript speaker labels and the participant panel. Hosts need this
   * when the viewer cannot read card identities through `engine.query` (the usual case for the `player` viewer);
   * without it labels fall back to the identity query, then to the raw id.
   */
  displayName?: (id: string) => string | undefined;
  /** Shown in layout when no scene is active (host-provided copy). */
  noSceneHint?: string;
  /** BCP-47 UI locale for built-in TUI strings (default: negotiate from env). */
  uiLocale?: string;
  /** Free-roam text routing before rejecting input (game-provided). */
  resolveFreeInput?: ResolveFreeInputFn;
  /** Mask restricted-rated gallery rows until revealed (game policy). */
  galleryPresentation?: GalleryPresentationFn;
  /** Open gallery image path (`o` in gallery panel, `:gallery open`). */
  openFile?: (path: string) => void | Promise<void>;
  /** Optional capture gate (consent, policy) before `engine.gallery.capture`. */
  galleryCapture?: (
    api: CommandApi,
    req?: GalleryCaptureRequest,
  ) => Promise<{ item: string; job: string }>;
  /** Mask entry titles in global gallery toasts (same policy as `galleryPresentation`). */
  galleryNotices?: {
    maskTitle?: (item: GalleryItemView) => boolean;
  };
}

export interface GalleryPresentation {
  blur?: boolean;
}

export type GalleryPresentationFn = (item: GalleryItemView) => GalleryPresentation;

export interface TranscriptCue {
  type: string;
  args: Record<string, unknown>;
  at: number;
  speaker?: string;
}

export interface TranscriptEntry {
  id: string;
  /** `narration` is a speaker-less paragraph of the narrator (`style` says how it is set off). */
  kind: "system" | "dialogue" | "action" | "sfx" | "narration";
  speaker?: string;
  /** Narration entries only; absent means `normal`. */
  style?: NarrationStyle;
  text: string;
  cues?: TranscriptCue[];
  expressionLabel?: string;
  turnId?: TurnId;
  complete: boolean;
}

export interface ChoiceState {
  choices: Array<{ id: string; text: string }>;
  selected: number;
}
