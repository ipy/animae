import type { Engine, JsonValue, TurnChunk, Viewer } from "@animae/engine";
import type { LocalizableValue } from "@animae/i18n";
import type { SceneId } from "@animae/engine";

export type HostArgFieldType = "text" | "select" | "enum" | "number" | "entity";

export interface HostArgField {
  id: string;
  label: string;
  type: HostArgFieldType;
  optional?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** JSON-schema-like hints for frontends */
  min?: number;
  max?: number;
  placeholder?: string;
}

/** Mirrors TUI `OverlayId` — host-neutral overlay names for remote UIs. */
export type HostOverlayId =
  | "help"
  | "eventLog"
  | "timeline"
  | "explain"
  | "inspector"
  | "sidePanel"
  | "loadSlots"
  | "rewindConfirm"
  | string;

export type HostResolveFreeInputFn = (
  text: string,
  api: HostCommandApi,
  focusTarget?: string,
) => Promise<"turn" | "handled">;

export interface HostCommandApi {
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
  attachScene?(id: SceneId): void;
  notify(text: LocalizableValue, level?: "info" | "warn" | "error"): void;
  openOverlay(name: HostOverlayId): void;
  closeOverlay(): void;
  setMouseCapture(on: boolean): void;
  /** Viewer UI locale (web: per-client; TUI: `:lang` / `--lang`). */
  locale?(): string;
  /** Translate host catalog keys for the current viewer locale. */
  t?(key: string, params?: Record<string, string | number | boolean | null | undefined>): string;
}

export interface HostCommandUiBridge {
  openOverlay(name: HostOverlayId): void;
  closeOverlay(): void;
  setMouseCapture(on: boolean): void;
}

export interface HostActionContext {
  engine: Engine;
  viewer: Viewer;
  actor: string;
  sceneId: () => string | undefined;
  focusTarget?: string;
  commandApi: HostCommandApi;
}

export interface HostAction {
  id: string;
  label: string;
  hint?: string;
  hotkey?: string;
  palette?: boolean;
  toolbar?: boolean;
  when?: (ctx: HostActionContext) => boolean;
  args?: HostArgField[];
  run: (ctx: HostActionContext, args: Record<string, string>) => void | Promise<void>;
}

export interface HostEntityAction {
  id: string;
  label: string;
  hint?: string;
  hotkey?: string;
  when?: (ctx: HostActionContext, entityId: string) => boolean;
  args?: HostArgField[];
  run: (ctx: HostActionContext, entityId: string, args: Record<string, string>) => void | Promise<void>;
}

export interface HostCommand {
  /** `host` catalog key (e.g. `command.desc.help`); resolve with `api.t` for display. */
  description: string;
  usage?: string;
  run(args: string[], api: HostCommandApi): Promise<string | void>;
}

export interface HostPanelSection {
  id: string;
  title: string;
  order?: number;
  data(ctx: { viewer: Viewer; engine: Engine; locale: string }): unknown | Promise<unknown>;
}

export interface TranscriptEntry {
  id: string;
  kind: "dialogue" | "narration" | "action" | "system" | "thought";
  speaker?: string;
  text: LocalizableValue;
  /** Resolved copy + key for clients after `localizeSnapshot` (wire protocol). */
  i18n?: { key: string; params?: Record<string, JsonValue> };
  complete: boolean;
  turnId?: string;
}

export interface HostChoiceState {
  choices: Array<{ id: string; text: string }>;
  selected: number;
}

export interface HostSessionUiState {
  sceneId?: string;
  /** Non-actor participants in the active scene (for remote UIs). */
  sceneParticipants?: string[];
  hasScene: boolean;
  focusTarget?: string;
  pending: boolean;
  speaking: boolean;
  turnError?: LocalizableValue;
  choices?: HostChoiceState;
  transcript: TranscriptEntry[];
  /** Max transcript entries retained server-side */
  transcriptLimit: number;
  /** Active modal/overlay id for remote clients (null = closed). */
  overlay?: HostOverlayId | null;
  /** When side panel is opened, optional tab id for web/TUI sidebars. */
  sidePanelTab?: string;
  mouseCapture?: boolean;
}

export interface HostHeaderState {
  time?: { day: number; minute: number; label: LocalizableValue };
  location?: string;
  chapter?: string;
  branch?: string;
}

export interface HostFooterState {
  beat?: string;
  budget?: unknown;
  hints?: string[];
}

export type StreamSegmentKind = "narration" | "dialogue" | "thought" | "system" | "event";

export interface StreamCallbacks {
  onStreamStart?(requestId: string, kind: StreamSegmentKind, speaker?: string): void;
  onStreamDelta?(requestId: string, text: string): void;
  onStreamEnd?(requestId: string, turnId?: string): void;
  onToast?(level: "info" | "warn" | "error", text: string): void;
  onBusy?(active: boolean, requestId?: string): void;
  onStateChange?(): void;
}

export type TurnChunkHandler = (chunk: TurnChunk) => void;
