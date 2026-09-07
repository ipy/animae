import type { Engine, TurnChunk, Viewer } from "@animae/engine";
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
  notify(text: string, level?: "info" | "warn" | "error"): void;
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
  description: string;
  usage?: string;
  run(args: string[], api: HostCommandApi): Promise<string | void>;
}

export interface HostPanelSection {
  id: string;
  title: string;
  order?: number;
  data(ctx: { viewer: Viewer; engine: Engine }): unknown | Promise<unknown>;
}

export interface TranscriptEntry {
  id: string;
  kind: "dialogue" | "narration" | "action" | "system" | "thought";
  speaker?: string;
  text: string;
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
  turnError?: string;
  choices?: HostChoiceState;
  transcript: TranscriptEntry[];
  /** Max transcript entries retained server-side */
  transcriptLimit: number;
}

export interface HostHeaderState {
  time?: { day: number; minute: number; label: string };
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
