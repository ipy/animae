import type { Engine, TurnChunk } from "@animae/engine";
import type { SceneId, TurnId, Viewer } from "@animae/engine";
import type { ReactNode, ComponentType } from "react";
import type { ThemePatch } from "./theme/schema.ts";

export type { Engine, TurnChunk, SceneId, TurnId, Viewer };

export type LayoutFocus = "transcript" | "sidePanel" | "input" | "choices";

export type OverlayId =
  | "help"
  | "eventLog"
  | "timeline"
  | "explain"
  | "inspector"
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
  label: string;
  type: "text" | "select";
  options?: Array<{ value: string; label: string }>;
  optional?: boolean;
}

export interface TuiAction {
  id: string;
  label: string;
  hint?: string;
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
  label: string;
  hint?: string;
  hotkey?: string;
  when?: (ctx: ActionContext, entityId: string) => boolean;
  args?: ActionArgField[];
  run: (ctx: ActionContext, entityId: string, args: Record<string, string>) => void | Promise<void>;
}

export interface PromptRequest {
  title: string;
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
  notify(text: string, level?: "info" | "warn" | "error"): void;
  openOverlay(name: OverlayId): void;
  closeOverlay(): void;
  setMouseCapture(on: boolean): void;
}

export interface CustomCommand {
  description: string;
  usage?: string;
  run(args: string[], api: CommandApi): Promise<string | void>;
}

export interface SidePanelSection {
  id: string;
  title: string;
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
  onSceneEnd?: (report: unknown) => void;
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
}

export interface TranscriptCue {
  type: string;
  args: Record<string, unknown>;
  at: number;
  speaker?: string;
}

export interface TranscriptEntry {
  id: string;
  kind: "system" | "dialogue" | "action" | "sfx";
  speaker?: string;
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
