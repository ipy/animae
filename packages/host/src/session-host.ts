import type { Engine, Viewer } from "@animae/engine";
import { AnimaeError } from "@animae/engine";
import type { FormatParams, I18nInstance, LocalizableValue } from "@animae/i18n";
import { localizeError, resolveText, scopedI18n } from "@animae/i18n";
import { runHostCommandLine } from "./builtin-commands.ts";
import { createHostCommandApi, setHostSceneId, type CommandApiState } from "./command-api.ts";
import { createHostI18n } from "./i18n/host-i18n.ts";
import { consumeTurnStream } from "./turn-consumer.ts";
import type {
  GalleryCaptureRequest,
  GalleryItemView,
  GalleryJobView,
  GalleryListOptions,
  GalleryNotice,
  GalleryRatingView,
} from "@animae/engine";
import { galleryNoticeToast } from "./gallery-notice-toast.ts";
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
  /** Open gallery image files (`:gallery open`, TUI `o`). */
  openFile?: (path: string) => void | Promise<void>;
  /**
   * How gallery notices (unlocks, finished renders) talk about an entry. Titles are shown by default; a game that
   * hides some entries behind a content mask returns `true` from `maskTitle` and the notice stays generic.
   * `toasts: false` is for clients that render their own gallery toasts from `onGalleryNotice`.
   */
  galleryNotices?: {
    maskTitle?: (item: GalleryItemView) => boolean;
    toasts?: boolean;
  };
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
  private readonly galleryNotices: NonNullable<SessionHostOptions["galleryNotices"]>;
  private i18n: I18nInstance;

  private activeTurnAbort?: AbortController;
  private activeRequestId?: string;
  private endDayInFlight = false;
  private streamCallbacks: StreamCallbacks = {};
  private galleryUnsub?: () => void;
  /** Player free-text cap (colon commands exempt). */
  static readonly maxPlayerInputChars = 4096;

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
    this.galleryNotices = opts.galleryNotices ?? {};

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
      locale: () => this.activeI18n.locale,
      t: (key: string, params?: FormatParams) => this.activeI18n.t(key, params),
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
      opts.openFile,
      () => this.ui.focusTarget,
    );

    this.galleryUnsub = this.engine.gallery.subscribe((notice) => {
      this.streamCallbacks.onGalleryNotice?.(notice);
      this.handleGalleryNotice(notice);
    });

    if (opts.initialMessage) {
      this.appendSystemLine(opts.initialMessage, "info");
    }
    this.syncSceneFlag();
  }

  setStreamCallbacks(cb: StreamCallbacks): void {
    this.streamCallbacks = { ...this.streamCallbacks, ...cb };
  }

  private galleryLocale(): string {
    return this.i18n.locale;
  }

  private galleryListOpts(extra?: GalleryListOptions): GalleryListOptions {
    return { locale: this.galleryLocale(), ...extra };
  }

  async galleryList(opts?: GalleryListOptions): Promise<GalleryItemView[]> {
    return this.engine.gallery.list(this.galleryListOpts(opts));
  }

  async galleryGet(id: string, opts?: GalleryListOptions): Promise<GalleryItemView | undefined> {
    return this.engine.gallery.get(id, this.galleryListOpts(opts));
  }

  galleryRatings(): GalleryRatingView[] {
    return this.engine.gallery.ratings();
  }

  galleryJobs(): GalleryJobView[] {
    return this.engine.gallery.jobs();
  }

  galleryGeneratorAvailable(): boolean {
    return this.engine.gallery.generatorAvailable();
  }

  async galleryUnlock(id: string, why?: { source?: string }): Promise<GalleryItemView> {
    return this.engine.gallery.unlock(id, why);
  }

  async galleryCapture(req?: GalleryCaptureRequest): Promise<{ item: string; job: string }> {
    return this.engine.gallery.capture(req);
  }

  async galleryRender(id: string, opts?: { reroll?: boolean; seed?: number }): Promise<{ job: string }> {
    return this.engine.gallery.render(id, opts);
  }

  async galleryCancel(job: string): Promise<boolean> {
    return this.engine.gallery.cancel(job);
  }

  async galleryRemove(id: string): Promise<void> {
    return this.engine.gallery.remove(id);
  }

  async galleryPin(id: string, pinned: boolean): Promise<void> {
    return this.engine.gallery.pin(id, pinned);
  }

  async galleryImage(id: string) {
    return this.engine.gallery.image(id);
  }

  /** The entry's title for a notice, or `undefined` when it is unknown or masked (the notice then stays generic). */
  private async galleryNoticeTitle(id: string): Promise<string | undefined> {
    try {
      const view = await this.engine.gallery.get(id, this.galleryListOpts({ includeUnavailable: true }));
      if (!view || this.galleryNotices.maskTitle?.(view)) return undefined;
      return view.title.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private handleGalleryNotice(notice: GalleryNotice): void {
    if (notice.type === "changed") {
      this.streamCallbacks.onStateChange?.();
      return;
    }
    void this.deliverGalleryNotice(notice).catch(() => this.streamCallbacks.onStateChange?.());
  }

  private async deliverGalleryNotice(notice: Exclude<GalleryNotice, { type: "changed" }>): Promise<void> {
    const t = (key: string, params?: Record<string, string | number>) =>
      this.activeI18n.t(key, params, { ns: "host" });
    const toast = (level: "info" | "error", text: string) => {
      if (this.galleryNotices.toasts !== false) this.streamCallbacks.onToast?.(level, text);
    };
    if (notice.type === "unlocked") {
      const title = await this.galleryNoticeTitle(notice.item);
      const key = title ? "gallery.notice.unlocked" : "gallery.notice.unlocked_generic";
      const params = title ? { item: title } : undefined;
      this.appendSystemLine({ i18n: { key, params } });
      toast("info", t(key, params));
    } else {
      const payload = await galleryNoticeToast(notice, {
        locale: this.galleryLocale(),
        getItem: (id) => this.engine.gallery.get(id, this.galleryListOpts({ includeUnavailable: true })),
        maskTitle: this.galleryNotices.maskTitle,
        t,
      });
      if (payload) toast(payload.level, payload.text);
    }
    this.streamCallbacks.onStateChange?.();
  }

  dispose(): void {
    this.galleryUnsub?.();
    this.galleryUnsub = undefined;
  }

  /** Attach an already-started engine scene (e.g. after external bootstrap). */
  attachScene(sceneId: string): void {
    setHostSceneId(this.apiState, sceneId);
    this.syncSceneFlag();
  }

  /** Mirror the engine's open scene into the host state (the engine is the source of truth). */
  private syncSceneFlag(): void {
    const sid = this.commandApi.sceneId();
    this.ui.sceneId = sid;
    this.ui.hasScene = Boolean(sid);
  }

  setUiLocale(locale: string): void {
    this.i18n = createHostI18n(locale);
  }

  uiLocale(): string {
    return this.i18n.locale;
  }

  /** Host translator bound to the locale of the request being handled (see `runWithLocale`), else the process locale. */
  private get activeI18n(): I18nInstance {
    return scopedI18n(this.i18n);
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
      sceneId: () => this.commandApi.sceneId(),
      focusTarget,
      commandApi: this.commandApi,
    };
  }

  private resolveActionArgs(args?: HostAction["args"]): ActionDescriptor["args"] {
    if (!args?.length) return undefined;
    return args.map((f) => ({
      ...f,
      label: resolveText(f.label),
      options: f.options?.map((o) => ({ ...o, label: resolveText(o.label) })),
    }));
  }

  listActions(focusTarget?: string): ActionDescriptor[] {
    const ctx = this.actionContext(focusTarget);
    const out: ActionDescriptor[] = [];
    for (const a of this.actions) {
      if (a.when && !a.when(ctx)) continue;
      out.push({
        id: a.id,
        label: resolveText(a.label),
        hint: a.hint ? resolveText(a.hint) : undefined,
        hotkey: a.hotkey,
        toolbar: a.toolbar,
        args: this.resolveActionArgs(a.args),
      });
    }
    if (focusTarget) {
      for (const a of this.entityActions) {
        if (a.when && !a.when(ctx, focusTarget)) continue;
        out.push({
          id: `entity:${a.id}`,
          label: resolveText(a.label),
          hint: a.hint ? resolveText(a.hint) : undefined,
          hotkey: a.hotkey,
          entityScoped: true,
          args: this.resolveActionArgs(a.args),
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
        location: this.engine.query(this.viewer, "world/location"),
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
    let cancelled = false;
    if (this.activeTurnAbort && (!requestId || requestId === this.activeRequestId)) {
      this.activeTurnAbort.abort();
      this.activeTurnAbort = undefined;
      cancelled = true;
    }
    if (this.ui.pending || this.endDayInFlight) {
      this.ui.pending = false;
      this.endDayInFlight = false;
      cancelled = true;
    }
    if (cancelled) {
      this.streamCallbacks.onBusy?.(false, this.activeRequestId ?? requestId);
      this.streamCallbacks.onStateChange?.();
    }
    return cancelled;
  }

  /** Serialize colon commands, palette commands, and player turns (prevents overlapping engine work). */
  private async withExclusiveControl<T>(requestId: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (this.ui.pending) {
      throw new AnimaeError("TURN_IN_PROGRESS", "TURN_IN_PROGRESS", undefined, {
        messageKey: "error.turn_in_progress",
        namespace: "host",
      });
    }
    this.ui.pending = true;
    this.streamCallbacks.onBusy?.(true, requestId);
    try {
      return await fn();
    } finally {
      this.ui.pending = false;
      this.streamCallbacks.onBusy?.(false, requestId);
    }
  }

  async runCommand(name: string, args: string[], requestId?: string): Promise<void> {
    await this.withExclusiveControl(requestId, async () => {
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
    });
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
      if (actionId === "endday") {
        if (this.endDayInFlight) {
          this.commandApi.notify(this.activeI18n.t("error.endday_in_progress", { ns: "host" }), "warn");
          return;
        }
        this.endDayInFlight = true;
        try {
          await this.withExclusiveControl(undefined, async () => {
            await act.run(ctx, args);
          });
        } finally {
          this.endDayInFlight = false;
        }
      } else {
        await act.run(ctx, args);
      }
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
    if (!trimmed.startsWith(":") && trimmed.length > SessionHost.maxPlayerInputChars) {
      throw new AnimaeError("INPUT_TOO_LONG", "INPUT_TOO_LONG", undefined, {
        messageKey: "error.input_too_long",
        namespace: "host",
      });
    }
    if (trimmed.startsWith(":")) {
      await this.withExclusiveControl(requestId, async () => {
        await runHostCommandLine(trimmed, this.commandApi, this.commands);
      });
      this.syncSceneFlag();
      this.streamCallbacks.onStateChange?.();
      return;
    }
    let sceneId = this.commandApi.sceneId();
    if (!sceneId && this.resolveFreeInput) {
      const pick = choiceId && !text.trim() ? choiceId : text;
      const routed = await this.resolveFreeInput(pick, this.commandApi, this.ui.focusTarget);
      if (routed === "handled") {
        this.syncSceneFlag();
        this.streamCallbacks.onStateChange?.();
        return;
      }
      sceneId = this.commandApi.sceneId();
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
        actor: this.actor,
      });
    } catch (err) {
      const i18n = this.activeI18n;
      const localized = localizeError(err, i18n.t.bind(i18n));
      let neutral: LocalizableValue = localized;
      if (err instanceof AnimaeError && err.messageKey) {
        const key = err.messageNamespace ? `${err.messageNamespace}:${err.messageKey}` : err.messageKey;
        neutral = { i18n: { key, params: err.params } };
      } else if (err instanceof AnimaeError && err.params) {
        neutral = {
          i18n: {
            key: `error.${err.code.toLowerCase().replace(/-/g, "_")}`,
            params: err.params as Record<string, string | number>,
          },
        };
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
    location: engine.query(viewer, "world/location") as string | undefined,
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
