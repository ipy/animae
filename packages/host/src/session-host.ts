import type { Engine, Viewer } from "@animae/engine";
import { AnimaeError } from "@animae/engine";
import type { FormatParams, I18nInstance, LocalizableValue } from "@animae/i18n";
import { localizeError } from "@animae/i18n";
import { runHostCommandLine } from "./builtin-commands.ts";
import { createHostCommandApi, setHostSceneId, type CommandApiState } from "./command-api.ts";
import { createHostI18n } from "./i18n/host-i18n.ts";
import { consumeTurnStream } from "./turn-consumer.ts";
import type {
  HostAction,
  HostActionContext,
  HostCommand,
  HostEntityAction,
  HostFooterState,
  HostHeaderState,
  HostPanelSection,
  HostSessionUiState,
  StreamCallbacks,
} from "./types.ts";

export interface SessionHostOptions {
  engine: Engine;
  /** Default UI locale for host chrome (per-client web servers may localize snapshots separately). */
  uiLocale?: string;
  i18n?: I18nInstance;
  viewer?: Viewer;
  actor?: string;
  commands?: Record<string, HostCommand>;
  actions?: HostAction[];
  entityActions?: HostEntityAction[];
  panels?: HostPanelSection[];
  initialMessage?: string;
  transcriptLimit?: number;
  onSceneEnd?: (api: ReturnType<typeof createHostCommandApi>) => void | Promise<void>;
  headerState?: (ctx: { engine: Engine; viewer: Viewer; locale: string }) => HostHeaderState | Promise<HostHeaderState>;
  footerState?: (ctx: { engine: Engine; viewer: Viewer }) => HostFooterState | Promise<HostFooterState>;
  /** When a colon command runs, open the side panel on this tab (game-specific map). */
  sidePanelTabForCommand?: Record<string, string>;
  /** Free-roam routing before NO_SCENE errors (game-provided). */
  resolveFreeInput?: import("./types.ts").HostResolveFreeInputFn;
}

export interface ActionDescriptor {
  id: string;
  label: string;
  hint?: string;
  hotkey?: string;
  toolbar?: boolean;
  entityScoped?: boolean;
  args?: HostAction["args"];
}

let systemLineSeq = 0;

export class SessionHost {
  readonly engine: Engine;
  readonly viewer: Viewer;
  readonly actor: string;
  readonly ui: HostSessionUiState;

  private readonly commands: Record<string, HostCommand>;
  private readonly actions: HostAction[];
  private readonly entityActions: HostEntityAction[];
  private readonly panels: HostPanelSection[];
  private readonly apiState: CommandApiState = {};
  private readonly commandApi: ReturnType<typeof createHostCommandApi>;
  private readonly onSceneEnd?: SessionHostOptions["onSceneEnd"];
  private readonly headerFn?: SessionHostOptions["headerState"];
  private readonly footerFn?: SessionHostOptions["footerState"];
  private readonly sidePanelTabForCommand: Record<string, string>;
  private readonly resolveFreeInput?: import("./types.ts").HostResolveFreeInputFn;
  private i18n: I18nInstance;

  private activeTurnAbort?: AbortController;
  private activeRequestId?: string;
  private streamCallbacks: StreamCallbacks = {};

  constructor(opts: SessionHostOptions) {
    this.engine = opts.engine;
    this.i18n = opts.i18n ?? createHostI18n(opts.uiLocale);
    this.viewer = opts.viewer ?? "player";
    this.actor = opts.actor ?? "player";
    this.commands = opts.commands ?? {};
    this.actions = opts.actions ?? [];
    this.entityActions = opts.entityActions ?? [];
    this.panels = [...(opts.panels ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.onSceneEnd = opts.onSceneEnd;
    this.headerFn = opts.headerState;
    this.footerFn = opts.footerState;
    this.sidePanelTabForCommand = opts.sidePanelTabForCommand ?? {};
    this.resolveFreeInput = opts.resolveFreeInput;

    this.ui = {
      hasScene: false,
      pending: false,
      speaking: false,
      transcript: [],
      transcriptLimit: opts.transcriptLimit ?? 400,
      overlay: null,
      mouseCapture: false,
    };

    const uiBridge = {
      openOverlay: (name: string) => {
        this.ui.overlay = name;
        const dot = name.indexOf(".");
        if (dot > 0) {
          this.ui.sidePanelTab = name.slice(dot + 1);
          this.ui.overlay = name.slice(0, dot);
        }
        if (name === "sidePanel" || this.ui.overlay === "sidePanel") {
          /* keep sidePanelTab if set */
        }
        this.streamCallbacks.onStateChange?.();
      },
      closeOverlay: () => {
        this.ui.overlay = null;
        this.streamCallbacks.onStateChange?.();
      },
      setMouseCapture: (on: boolean) => {
        this.ui.mouseCapture = on;
        this.streamCallbacks.onStateChange?.();
      },
    };

    const i18nBridge = {
      locale: () => this.i18n.locale,
      t: (key: string, params?: FormatParams) => this.i18n.t(key, params),
    };
    this.commandApi = createHostCommandApi(
      this.engine,
      this.viewer,
      this.actor,
      this.apiState,
      (text, level) => {
        this.appendSystemLine(text, level);
        this.streamCallbacks.onToast?.(level ?? "info", text);
      },
      uiBridge,
      i18nBridge,
    );

    if (opts.initialMessage) {
      this.appendSystemLine(opts.initialMessage, "info");
    }
    this.syncSceneFlag();
  }

  setStreamCallbacks(cb: StreamCallbacks): void {
    this.streamCallbacks = cb;
  }

  /** Attach an already-started engine scene (e.g. after external bootstrap). */
  attachScene(sceneId: string): void {
    setHostSceneId(this.apiState, sceneId);
    this.syncSceneFlag();
  }

  private syncSceneFlag(): void {
    const sid = this.apiState.sceneId;
    this.ui.sceneId = sid;
    this.ui.hasScene = Boolean(sid);
  }

  setUiLocale(locale: string): void {
    this.i18n = createHostI18n(locale);
  }

  uiLocale(): string {
    return this.i18n.locale;
  }

  private appendSystemLine(text: LocalizableValue, _level?: "info" | "warn" | "error"): void {
    this.ui.transcript.push({
      id: `sys_${++systemLineSeq}`,
      kind: "system",
      text,
      complete: true,
    });
    while (this.ui.transcript.length > this.ui.transcriptLimit) this.ui.transcript.shift();
  }

  actionContext(focusTarget?: string): HostActionContext {
    return {
      engine: this.engine,
      viewer: this.viewer,
      actor: this.actor,
      sceneId: () => this.apiState.sceneId,
      focusTarget,
      commandApi: this.commandApi,
    };
  }

  listActions(focusTarget?: string): ActionDescriptor[] {
    const ctx = this.actionContext(focusTarget);
    const out: ActionDescriptor[] = [];
    for (const a of this.actions) {
      if (a.when && !a.when(ctx)) continue;
      out.push({
        id: a.id,
        label: a.label,
        hint: a.hint,
        hotkey: a.hotkey,
        toolbar: a.toolbar,
        args: a.args,
      });
    }
    if (focusTarget) {
      for (const a of this.entityActions) {
        if (a.when && !a.when(ctx, focusTarget)) continue;
        out.push({
          id: `entity:${a.id}`,
          label: a.label,
          hint: a.hint,
          hotkey: a.hotkey,
          entityScoped: true,
          args: a.args,
        });
      }
    }
    return out;
  }

  async buildSnapshot(opts?: { locale?: string }): Promise<Record<string, unknown>> {
    if (opts?.locale) this.setUiLocale(opts.locale);
    this.syncSceneFlag();
    const header = this.headerFn
      ? await this.headerFn({ engine: this.engine, viewer: this.viewer, locale: this.i18n.locale })
      : defaultHeader(this.engine, this.viewer);
    const footer = this.footerFn
      ? await this.footerFn({ engine: this.engine, viewer: this.viewer })
      : defaultFooter(this.engine, this.viewer);

    const panelData: Record<string, unknown> = {};
    for (const p of this.panels) {
      panelData[p.id] = await p.data({ engine: this.engine, viewer: this.viewer, locale: this.i18n.locale });
    }

    const liveScene = this.engine.query(this.viewer, "scene") as { participants?: string[] } | null | undefined;
    const participants =
      this.apiState.sceneParticipants ??
      liveScene?.participants?.filter((p: string) => p !== this.actor) ??
      [];

    return {
      protocolVersion: 1,
      scene: {
        id: this.ui.sceneId,
        active: this.ui.hasScene,
        location: this.engine.query(this.viewer, "world.location"),
        speaker: this.ui.speaking ? ({ i18n: { key: "header.speaker_busy" } } satisfies LocalizableValue) : undefined,
        participants,
      },
      header,
      footer,
      transcript: this.ui.transcript.slice(-80),
      choices: this.ui.choices,
      focusTarget: this.ui.focusTarget,
      pending: this.ui.pending,
      turnError: this.ui.turnError,
      actions: this.listActions(this.ui.focusTarget),
      panels: panelData,
      roster: this.engine.query(this.viewer, "characters"),
      jobs: this.engine.query(this.viewer, "world.vars"),
      resources: this.engine.query(this.viewer, "world.vars"),
      factions: this.engine.query(this.viewer, "world.vars"),
      calendar: this.engine.query(this.viewer, "world.calendar"),
      achievements: this.engine.query(this.viewer, "world.vars"),
      mods: this.engine.mods?.() ?? null,
      branch: this.engine.timeline.current().name,
      ui: {
        overlay: this.ui.overlay ?? null,
        sidePanelTab: this.ui.sidePanelTab,
        mouseCapture: this.ui.mouseCapture ?? false,
      },
    };
  }

  async startScene(params: { location: string; participants: string[]; fields?: string[] }): Promise<void> {
    await this.commandApi.startScene(params);
    this.syncSceneFlag();
    this.streamCallbacks.onStateChange?.();
  }

  async endScene(): Promise<void> {
    await this.commandApi.endScene();
    if (this.onSceneEnd) await this.onSceneEnd(this.commandApi);
    this.syncSceneFlag();
    this.streamCallbacks.onStateChange?.();
  }

  selectFocus(entityId?: string): void {
    this.ui.focusTarget = entityId;
    this.streamCallbacks.onStateChange?.();
  }

  cancelActive(requestId?: string): boolean {
    if (this.activeTurnAbort && (!requestId || requestId === this.activeRequestId)) {
      this.activeTurnAbort.abort();
      this.activeTurnAbort = undefined;
      this.ui.pending = false;
      this.streamCallbacks.onBusy?.(false, this.activeRequestId);
      return true;
    }
    return false;
  }

  async runCommand(name: string, args: string[], requestId?: string): Promise<void> {
    const tabHint = this.sidePanelTabForCommand[name];
    if (tabHint) {
      this.ui.sidePanelTab = tabHint;
      this.ui.overlay = "sidePanel";
    }
    const cmd = this.commands[name];
    if (cmd) {
      const out = await cmd.run(args, this.commandApi);
      if (typeof out === "string" && out.length) this.commandApi.notify(out);
    } else {
      const argPart = args.length ? ` ${args.join(" ")}` : "";
      await runHostCommandLine(`:${name}${argPart}`, this.commandApi, this.commands);
    }
    this.syncSceneFlag();
    this.streamCallbacks.onStateChange?.();
    void requestId;
  }

  async runAction(actionId: string, args: Record<string, string>, entityId?: string): Promise<void> {
    const ctx = this.actionContext(entityId ?? this.ui.focusTarget);
    if (actionId.startsWith("entity:")) {
      const eid = entityId ?? this.ui.focusTarget;
      if (!eid) {
        throw new AnimaeError("NO_FOCUS", "NO_FOCUS", undefined, {
          messageKey: "error.no_focus",
          namespace: "host",
        });
      }
      const rawId = actionId.slice("entity:".length);
      const act = this.entityActions.find((a) => a.id === rawId);
      if (!act) {
        throw new AnimaeError("UNKNOWN_ACTION", "UNKNOWN_ACTION", undefined, {
          messageKey: "error.unknown_entity_action",
          namespace: "host",
          params: { id: rawId },
        });
      }
      await act.run(ctx, eid, args);
    } else {
      const act = this.actions.find((a) => a.id === actionId);
      if (!act) {
        throw new AnimaeError("UNKNOWN_ACTION", "UNKNOWN_ACTION", undefined, {
          messageKey: "error.unknown_action",
          namespace: "host",
          params: { id: actionId },
        });
      }
      await act.run(ctx, args);
    }
    this.syncSceneFlag();
    this.streamCallbacks.onStateChange?.();
  }

  async submitInput(
    text: string,
    choiceId?: string,
    requestId?: string,
    opts?: { outputLocale?: string },
  ): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.startsWith(":")) {
      await runHostCommandLine(trimmed, this.commandApi, this.commands);
      this.syncSceneFlag();
      this.streamCallbacks.onStateChange?.();
      return;
    }
    let sceneId = this.apiState.sceneId;
    if (!sceneId && this.resolveFreeInput) {
      const pick = choiceId && !text.trim() ? choiceId : text;
      const routed = await this.resolveFreeInput(pick, this.commandApi, this.ui.focusTarget);
      if (routed === "handled") {
        this.syncSceneFlag();
        this.streamCallbacks.onStateChange?.();
        return;
      }
      sceneId = this.apiState.sceneId;
    }
    if (!sceneId) {
      throw new AnimaeError("NO_SCENE", "NO_SCENE", undefined, {
        messageKey: "error.no_scene",
        namespace: "host",
      });
    }
    if (this.ui.pending) {
      throw new AnimaeError("TURN_IN_PROGRESS", "TURN_IN_PROGRESS", undefined, {
        messageKey: "error.turn_in_progress",
        namespace: "host",
      });
    }

    this.ui.pending = true;
    this.ui.turnError = undefined;
    this.ui.choices = undefined;
    this.activeRequestId = requestId;
    this.activeTurnAbort = new AbortController();
    this.streamCallbacks.onBusy?.(true, requestId);

    try {
      const stream = this.engine.scene.turn({
        sceneId,
        actor: this.actor,
        text,
        choiceId,
        outputLocale: opts?.outputLocale ?? this.i18n.locale,
      });
      await consumeTurnStream(stream, this.ui, {
        requestId,
        stream: this.streamCallbacks,
        abortSignal: this.activeTurnAbort?.signal,
      });
    } catch (err) {
      const localized = localizeError(err, this.i18n.t.bind(this.i18n));
      let neutral: LocalizableValue = localized;
      if (err instanceof AnimaeError && err.messageKey) {
        const key = err.messageNamespace ? `${err.messageNamespace}:${err.messageKey}` : err.messageKey;
        neutral = { i18n: { key, params: err.params } };
      }
      this.ui.turnError = neutral;
      this.appendSystemLine(neutral, "error");
      throw err;
    } finally {
      this.ui.pending = false;
      this.activeTurnAbort = undefined;
      this.activeRequestId = undefined;
      this.streamCallbacks.onBusy?.(false, requestId);
      this.streamCallbacks.onStateChange?.();
    }
  }

  async queryPath(path: string, viewer?: string): Promise<unknown> {
    const v = viewer ?? this.viewer;
    return this.engine.queryAsync ? await this.engine.queryAsync(v, path) : this.engine.query(v, path);
  }
}

function defaultHeader(engine: Engine, viewer: Viewer): HostHeaderState {
  const t = engine.world.now();
  const h = Math.floor(t.minute / 60);
  const m = t.minute % 60;
  const clock = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return {
    time: {
      day: t.day,
      minute: t.minute,
      label: { i18n: { key: "header.time_label", params: { day: t.day, time: clock } } },
    },
    location: engine.query(viewer, "world.location") as string | undefined,
    branch: engine.timeline.current().name,
  };
}

function defaultFooter(engine: Engine, viewer: Viewer): HostFooterState {
  const beat = engine.query(viewer, "director/beat") as { label?: string } | null;
  let budget: unknown;
  try {
    budget = engine.query(viewer, "budget");
  } catch {
    budget = undefined;
  }
  return { beat: beat?.label, budget };
}
