import type { ServerWebSocket } from "bun";
import { bindLocalizeTranslator, localizeSnapshot, SessionHost } from "@animae/host";
import { AnimaeError, type EngineEvent } from "@animae/engine";
import { localizeDeep, localizeValue, matchAvailableLocale, runWithLocale, type FormatParams } from "@animae/i18n";
import { ClientMessageSchema, type ServerMessage } from "../protocol/schemas.ts";
import { diffSnapshot } from "./snapshot-diff.ts";
import { WEB_PROTOCOL_VERSION } from "../protocol/version.ts";
import type { WebSecurityConfig } from "./security.ts";
import { WEB_SUPPORTED_LOCALES, createWebI18n, localeDisplayNames } from "../i18n/web-i18n.ts";

export type ClientRole = "controller" | "spectator";

export interface SessionRoomGalleryOptions {
  allowGalleryUnlock?: boolean;
}

export interface WebEnvironmentEntry {
  id: string;
  /** Plain text or `{ i18n: { key, ns? } }` resolved on `/api/environment` using the request locale. */
  label?: string | { i18n: { key: string; ns?: string } };
  value: string;
  kind?: "path" | "text";
}

export interface WebSessionHooks {
  configGet?(keys?: string[]): Promise<Record<string, unknown>>;
  configSet?(
    patch: Record<string, unknown>,
    consent?: { packId: string; phrase: string; noticeVersion: string },
  ): Promise<{ reloadRecommended?: boolean; restarting?: boolean; message?: string } | void>;
  modelsProbe?(
    slot?: "s1" | "s2",
    draft?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  imagesProbe?(draft?: Record<string, unknown>): Promise<Record<string, unknown>>;
  ollamaModels?(baseURL?: string): Promise<{ ok: boolean; models?: string[]; error?: string }>;
  contentPackNotice?(packId: string): Promise<{ notice: string; noticeVersion?: string }>;
  protagonistSet?(name: string): Promise<{ ok: boolean; error?: string }>;
  /** Host paths and version metadata for the diagnostics page (authenticated like other `/api/*` routes). */
  environment?(): Promise<WebEnvironmentEntry[]> | WebEnvironmentEntry[];
}

interface WsData {
  id: string;
  clientId: string;
  role: ClientRole;
  authenticated: boolean;
  messageTimes: number[];
  locale: string;
}

type WebI18n = ReturnType<typeof createWebI18n>;

/**
 * Localize the values inside an engine event while keeping the event's own shape: an event is a record, never a
 * localizable leaf itself, so a root-level `i18n` field must not collapse the whole event into a string.
 */
function localizeEventFields(e: EngineEvent, t: (key: string, params?: FormatParams) => string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) out[k] = localizeDeep(v, t);
  return out;
}

export class SessionRoom {
  readonly sessionId: string;
  readonly host: SessionHost;
  readonly security: WebSecurityConfig;
  readonly hooks: WebSessionHooks;

  private seq = 0;
  private controllerId?: string;
  private controllerClientId?: string;
  private releasedControllerClientId?: string;
  private releasedUntil = 0;
  private readonly controllerReclaimGraceMs = 12_000;
  private readonly clients = new Map<string, ServerWebSocket<WsData>>();
  private readonly patchBuffer: ServerMessage[] = [];
  private readonly patchBufferLimit = 500;
  private lastLocalizedSnapshot = new Map<string, Record<string, unknown>>();
  /** Per-client inbound queue so overlapping WS frames cannot run host work concurrently. */
  private readonly inboundChains = new Map<string, Promise<void>>();
  private engineUnsubs: Array<() => void> = [];
  /** Single-flight snapshot pump: overlapping triggers coalesce into one follow-up run (see `pushSnapshot`). */
  private snapshotRun?: Promise<void>;
  private snapshotRerun = false;
  private snapshotRerunFull = false;
  private readonly allowGalleryUnlock: boolean;

  constructor(
    sessionId: string,
    host: SessionHost,
    security: WebSecurityConfig,
    hooks: WebSessionHooks = {},
    gallery: SessionRoomGalleryOptions = {},
  ) {
    this.sessionId = sessionId;
    this.host = host;
    this.security = security;
    this.hooks = hooks;
    this.allowGalleryUnlock = gallery.allowGalleryUnlock ?? false;
    this.host.setStreamCallbacks({
      onGalleryNotice: (notice) => {
        this.broadcast({
          v: WEB_PROTOCOL_VERSION,
          type: "gallery_notice",
          seq: this.nextSeq(),
          notice,
        });
      },
      onStreamStart: (requestId, segment, speaker) => {
        this.broadcast({
          v: WEB_PROTOCOL_VERSION,
          type: "stream",
          seq: this.nextSeq(),
          requestId,
          phase: "start",
          segment,
          speaker,
        });
      },
      onStreamDelta: (requestId, text) => {
        this.broadcast({
          v: WEB_PROTOCOL_VERSION,
          type: "stream",
          seq: this.nextSeq(),
          requestId,
          phase: "delta",
          segment: "dialogue",
          text,
        });
      },
      onStreamEnd: (requestId, turnId) => {
        this.broadcast({
          v: WEB_PROTOCOL_VERSION,
          type: "stream",
          seq: this.nextSeq(),
          requestId,
          phase: "end",
          segment: "dialogue",
          turnId,
        });
        this.schedulePush();
      },
      onToast: (level, text) => {
        this.broadcastLocalized((i18n) => ({
          v: WEB_PROTOCOL_VERSION,
          type: "toast",
          seq: this.nextSeq(),
          level,
          text: String(localizeValue(text, bindLocalizeTranslator(i18n.t.bind(i18n), i18n.has.bind(i18n)))),
        }));
      },
      onBusy: (active, requestId) => {
        this.broadcast({
          v: WEB_PROTOCOL_VERSION,
          type: "busy",
          seq: this.nextSeq(),
          active,
          requestId,
        });
        if (!active) this.schedulePush();
      },
      onStateChange: () => {
        this.schedulePush();
      },
    });

    const off = this.host.engine.on("*", (e: EngineEvent) => {
      this.broadcastLocalized((i18n) => ({
        v: WEB_PROTOCOL_VERSION,
        type: "event",
        seq: this.nextSeq(),
        kind: e.kind,
        payload: localizeEventFields(e, bindLocalizeTranslator(i18n.t.bind(i18n), i18n.has.bind(i18n))),
      }));
    });
    this.engineUnsubs.push(off);
  }

  close(): void {
    this.host.dispose?.();
    for (const u of this.engineUnsubs) u();
    this.engineUnsubs = [];
    for (const ws of this.clients.values()) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private remember(msg: ServerMessage): void {
    if (msg.type === "stream" || msg.type === "busy") {
      this.patchBuffer.push(msg);
      while (this.patchBuffer.length > this.patchBufferLimit) this.patchBuffer.shift();
    }
  }

  private send(ws: ServerWebSocket<WsData>, msg: ServerMessage): void {
    this.remember(msg);
    ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage): void {
    this.remember(msg);
    const raw = JSON.stringify(msg);
    for (const ws of this.clients.values()) {
      ws.send(raw);
    }
  }

  /** Push a gallery notice to every connected client (e.g. after host-side availability changes). */
  emitGalleryNotice(notice: import("@animae/engine").GalleryNotice): void {
    this.broadcast({
      v: WEB_PROTOCOL_VERSION,
      type: "gallery_notice",
      seq: this.nextSeq(),
      notice,
    });
  }

  private broadcastLocalized(build: (i18n: WebI18n) => ServerMessage): void {
    for (const ws of this.clients.values()) {
      const i18n = this.i18nFor(ws);
      this.send(ws, build(i18n));
    }
  }

  private negotiateLocale(requested?: string): string {
    const tag = requested ?? this.host.uiLocale?.() ?? "en";
    return matchAvailableLocale(tag, WEB_SUPPORTED_LOCALES) ?? "en";
  }

  private i18nFor(ws: ServerWebSocket<WsData>): WebI18n {
    return createWebI18n(ws.data.locale);
  }

  private localizeState(state: Record<string, unknown>, i18n: WebI18n): Record<string, unknown> {
    return localizeSnapshot(state, i18n.t.bind(i18n), i18n.has.bind(i18n));
  }

  /** Fire-and-forget trigger for engine callbacks: a failed build is logged instead of becoming an unhandled rejection. */
  private schedulePush(): void {
    this.pushSnapshot().catch((err) => {
      console.error("[SessionRoom] snapshot push failed:", err);
    });
  }

  /**
   * Push the current state to every authenticated client.
   *
   * Snapshot builds are asynchronous and diff against the previously sent state, so overlapping runs could send
   * patches computed against a stale baseline (or let an older build overwrite a newer one). Runs are therefore
   * single-flight: a trigger that arrives mid-run schedules exactly one follow-up run, and every caller's promise
   * settles only after a run that *started after the call* has finished, so awaiting callers observe fresh state.
   */
  pushSnapshot(forceFull = false): Promise<void> {
    if (forceFull) this.snapshotRerunFull = true;
    if (this.snapshotRun) {
      this.snapshotRerun = true;
      return this.snapshotRun;
    }
    this.snapshotRerun = true;
    const run = (async () => {
      try {
        while (this.snapshotRerun) {
          this.snapshotRerun = false;
          const full = this.snapshotRerunFull;
          this.snapshotRerunFull = false;
          await this.pushSnapshotOnce(full);
        }
      } finally {
        this.snapshotRun = undefined;
      }
    })();
    this.snapshotRun = run;
    return run;
  }

  private async pushSnapshotOnce(forceFull: boolean): Promise<void> {
    for (const ws of this.clients.values()) {
      if (!ws.data.authenticated) continue;
      const i18n = this.i18nFor(ws);
      // Build inside the client's locale scope: panels translate with the process-wide game translator, and the
      // run may have been triggered by a request from a client with a different locale.
      const neutral = await runWithLocale(i18n, () => this.host.buildSnapshot({ locale: ws.data.locale }));
      const state = this.localizeState(neutral, i18n);
      const prev = this.lastLocalizedSnapshot.get(ws.data.id);
      if (!forceFull && prev) {
        const ops = diffSnapshot(prev, state);
        if (ops) {
          this.lastLocalizedSnapshot.set(ws.data.id, state);
          this.send(ws, {
            v: WEB_PROTOCOL_VERSION,
            type: "patch",
            seq: this.nextSeq(),
            ops,
          });
          continue;
        }
      }
      this.lastLocalizedSnapshot.set(ws.data.id, state);
      this.send(ws, {
        v: WEB_PROTOCOL_VERSION,
        type: "snapshot",
        seq: this.nextSeq(),
        state,
      });
    }
  }

  /**
   * Catch a connecting client up on streamed output.
   *
   * A returning client (`seq > 0`) receives everything after the last message it saw. A client that has seen nothing
   * (`seq === 0`: a fresh page or tab) has just received the whole state as a snapshot, so the stream of earlier
   * turns is not replayed (hundreds of messages would be applied to a page that already shows their result). Only
   * the turn that is running right now is, so a client that joins mid-turn follows its stream from the start.
   */
  replaySince(seq: number, ws: ServerWebSocket<WsData>): void {
    const start = seq > 0 ? 0 : this.runningTurnStart();
    if (start < 0) return;
    for (let i = start; i < this.patchBuffer.length; i++) {
      const msg = this.patchBuffer[i]!;
      if ("seq" in msg && typeof msg.seq === "number" && msg.seq > seq) {
        ws.send(JSON.stringify(msg));
      }
    }
  }

  /** Buffer index of the first message of the turn that is still running, or -1 when the last busy report says idle. */
  private runningTurnStart(): number {
    let start = -1;
    for (let i = this.patchBuffer.length - 1; i >= 0; i--) {
      const msg = this.patchBuffer[i]!;
      if (msg.type !== "busy") continue;
      if (!msg.active) break;
      start = i;
    }
    return start;
  }

  registerClient(ws: ServerWebSocket<WsData>, id: string): void {
    if (!ws.data.locale) ws.data.locale = "en";
    this.clients.set(id, ws);
  }

  removeClient(id: string): void {
    const wasController = this.controllerId === id;
    if (wasController) {
      this.releasedControllerClientId = this.controllerClientId;
      this.releasedUntil = Date.now() + this.controllerReclaimGraceMs;
      this.controllerId = undefined;
      this.host.cancelActive();
    }
    this.clients.delete(id);
    this.lastLocalizedSnapshot.delete(id);
    this.inboundChains.delete(id);
  }

  private assignController(ws: ServerWebSocket<WsData>, clientId: string): void {
    const prev = this.controllerId;
    if (prev && prev !== ws.data.id) {
      const old = this.clients.get(prev);
      if (old) {
        old.data.role = "spectator";
        const i18n = this.i18nFor(old);
        this.send(old, {
          v: WEB_PROTOCOL_VERSION,
          type: "role",
          seq: this.nextSeq(),
          role: "spectator",
          message: i18n.t("role.controller_lost"),
        });
      }
    }
    this.controllerId = ws.data.id;
    this.controllerClientId = clientId;
    if (clientId === this.releasedControllerClientId) {
      this.releasedControllerClientId = undefined;
      this.releasedUntil = 0;
    }
    ws.data.role = "controller";
  }

  private tryHelloController(ws: ServerWebSocket<WsData>, clientId: string): ClientRole {
    if (
      this.controllerId &&
      this.controllerId !== ws.data.id &&
      this.releasedControllerClientId === clientId &&
      Date.now() < this.releasedUntil
    ) {
      this.assignController(ws, clientId);
      return "controller";
    }
    if (!this.controllerId) {
      this.assignController(ws, clientId);
      return "controller";
    }
    if (this.controllerId === ws.data.id) {
      ws.data.role = "controller";
      return "controller";
    }
    ws.data.role = "spectator";
    return "spectator";
  }

  private rateLimit(data: WsData): boolean {
    const now = Date.now();
    data.messageTimes = data.messageTimes.filter((t) => now - t < 60_000);
    if (data.messageTimes.length >= this.security.maxMessagesPerMinute) return false;
    data.messageTimes.push(now);
    return true;
  }

  private err(
    ws: ServerWebSocket<WsData>,
    code: string,
    messageKey: string,
    params?: Record<string, unknown>,
    id?: string,
  ): void {
    const i18n = this.i18nFor(ws);
    this.send(ws, {
      v: WEB_PROTOCOL_VERSION,
      type: "error",
      seq: this.nextSeq(),
      code,
      message: i18n.t(messageKey, params as FormatParams | undefined),
      localized: true,
      params,
      id,
    });
  }

  private ok(ws: ServerWebSocket<WsData>, id: string, data?: unknown): void {
    this.send(ws, {
      v: WEB_PROTOCOL_VERSION,
      type: "result",
      seq: this.nextSeq(),
      id,
      ok: true,
      data,
    });
  }

  /**
   * Queue an inbound frame behind earlier frames from the same client (so overlapping WS frames never
   * run host work concurrently). The returned promise settles once *this* frame has been processed.
   */
  handleMessage(ws: ServerWebSocket<WsData>, raw: string | Buffer): Promise<void> {
    const key = ws.data.id;
    // `cancel` must overtake the turn it is meant to stop, so it bypasses the per-client queue.
    if (SessionRoom.peekFrameType(raw) === "cancel") {
      return this.handleMessageImpl(ws, raw).catch((err) => {
        console.error("[SessionRoom] inbound handler failed:", err);
      });
    }
    const prev = this.inboundChains.get(key) ?? Promise.resolve();
    const next = prev
      .then(() => this.handleMessageImpl(ws, raw))
      .catch((err) => {
        console.error("[SessionRoom] inbound handler failed:", err);
      });
    this.inboundChains.set(key, next);
    return next;
  }

  /** Best-effort frame type sniffing for queue routing; validation still happens in the handler. */
  private static peekFrameType(raw: string | Buffer): string | undefined {
    try {
      const parsed: unknown = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
      const type = (parsed as { type?: unknown } | null)?.type;
      return typeof type === "string" ? type : undefined;
    } catch {
      return undefined;
    }
  }

  private async handleMessageImpl(ws: ServerWebSocket<WsData>, raw: string | Buffer): Promise<void> {
    const data = ws.data;
    if (!this.rateLimit(data)) {
      this.err(ws, "RATE_LIMIT", "error.rate_limit");
      ws.close(1008, "rate limit");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
    } catch {
      this.err(ws, "PARSE", "error.parse");
      return;
    }

    const msg = ClientMessageSchema.safeParse(parsed);
    if (!msg.success) {
      this.err(ws, "INVALID_MESSAGE", "error.invalid_message");
      return;
    }

    const m = msg.data;

    if (m.type === "hello") {
      if (this.security.authToken && m.token !== this.security.authToken) {
        this.err(ws, "AUTH", "error.auth");
        ws.close(1008, "auth");
        return;
      }
      const clientId = m.clientId ?? data.clientId ?? data.id;
      data.clientId = clientId;
      data.locale = this.negotiateLocale(m.locale);
      const wantControl = (m.role ?? "controller") === "controller";
      if (wantControl) {
        data.role = this.tryHelloController(ws, clientId);
      } else {
        data.role = "spectator";
      }
      data.authenticated = true;
      const i18n = this.i18nFor(ws);
      this.send(ws, {
        v: WEB_PROTOCOL_VERSION,
        type: "hello_ok",
        seq: this.nextSeq(),
        sessionId: this.sessionId,
        role: data.role,
        controllerPresent: Boolean(this.controllerId),
        protocolVersion: WEB_PROTOCOL_VERSION,
        clientId,
        locale: data.locale,
        locales: localeDisplayNames(data.locale, WEB_SUPPORTED_LOCALES),
      });
      this.send(ws, {
        v: WEB_PROTOCOL_VERSION,
        type: "locale",
        seq: this.nextSeq(),
        locale: data.locale,
      });
      await this.pushSnapshot(true);
      if (typeof m.resumeSeq === "number") this.replaySince(m.resumeSeq, ws);
      return;
    }

    if (m.type === "set_locale") {
      if (!data.authenticated) {
        this.err(ws, "HELLO_REQUIRED", "error.hello_required", undefined, m.id);
        return;
      }
      const next = matchAvailableLocale(m.locale, WEB_SUPPORTED_LOCALES);
      if (!next) {
        this.err(ws, "INVALID", "locale.unsupported", { locale: m.locale }, m.id);
        return;
      }
      data.locale = next;
      this.lastLocalizedSnapshot.delete(data.id);
      await this.pushSnapshot(true);
      this.send(ws, {
        v: WEB_PROTOCOL_VERSION,
        type: "locale",
        seq: this.nextSeq(),
        locale: next,
      });
      this.ok(ws, m.id, { locale: next });
      return;
    }

    if (m.type === "release_control") {
      if (!data.authenticated) {
        this.err(ws, "HELLO_REQUIRED", "error.hello_required", undefined, m.id);
        return;
      }
      if (this.controllerId === data.id) {
        this.controllerId = undefined;
        this.controllerClientId = undefined;
        this.releasedControllerClientId = undefined;
        this.releasedUntil = 0;
        data.role = "spectator";
        this.send(ws, {
          v: WEB_PROTOCOL_VERSION,
          type: "role",
          seq: this.nextSeq(),
          role: "spectator",
        });
      }
      this.ok(ws, m.id, { role: data.role });
      return;
    }

    if (m.type === "claim_controller") {
      if (!data.authenticated) {
        this.err(ws, "HELLO_REQUIRED", "error.hello_required", undefined, m.id);
        return;
      }
      const clientId = data.clientId;
      if (!this.controllerId || m.force === true) {
        this.assignController(ws, clientId);
        this.send(ws, {
          v: WEB_PROTOCOL_VERSION,
          type: "role",
          seq: this.nextSeq(),
          role: "controller",
        });
        this.ok(ws, m.id, { role: "controller" });
        return;
      }
      if (this.controllerId === data.id) {
        this.ok(ws, m.id, { role: "controller" });
        return;
      }
      this.err(ws, "CONTROLLER_TAKEN", "error.controller_taken", undefined, m.id);
      return;
    }

    if (!data.authenticated) {
      this.err(ws, "HELLO_REQUIRED", "error.hello_required");
      return;
    }

    const needsControl = new Set([
      "input",
      "command",
      "action",
      "choose",
      "rewind",
      "branch",
      "save",
      "load",
      "config_set",
      "cancel",
      "models_probe",
      "images_probe",
      "ollama_models",
      "gallery_capture",
      "gallery_render",
      "gallery_cancel",
      "gallery_remove",
      "gallery_pin",
      "gallery_unlock",
    ]);
    if (needsControl.has(m.type) && data.role !== "controller") {
      this.err(ws, "READ_ONLY", "error.read_only", undefined, "id" in m ? m.id : undefined);
      return;
    }

    try {
      // Game and host strings produced while handling this frame follow the requesting client's locale.
      await runWithLocale(this.i18nFor(ws), async () => {
        switch (m.type) {
          case "ping":
            this.send(ws, { v: WEB_PROTOCOL_VERSION, type: "pong", seq: this.nextSeq(), id: m.id });
            break;
          case "get_state": {
            const neutral = await this.host.buildSnapshot({ locale: ws.data.locale });
            const state = this.localizeState(neutral, this.i18nFor(ws));
            this.ok(ws, m.id, { state });
            break;
          }
          case "select_focus":
            this.host.selectFocus(m.entityId);
            await this.pushSnapshot();
            if (m.id) this.ok(ws, m.id);
            break;
          case "input":
            if (m.text.length > SessionHost.maxPlayerInputChars && !m.text.trim().startsWith(":")) {
              this.err(ws, "INPUT_TOO_LONG", "error.input_too_long", undefined, m.id);
              break;
            }
            await this.host.submitInput(m.text, m.choiceId, m.id, { outputLocale: ws.data.locale });
            this.ok(ws, m.id);
            await this.pushSnapshot();
            break;
          case "choose":
            await this.host.submitInput("", m.choiceId, m.id, { outputLocale: ws.data.locale });
            this.ok(ws, m.id);
            break;
          case "command":
            await this.host.runCommand(m.name, m.args, m.id);
            this.ok(ws, m.id);
            await this.pushSnapshot();
            break;
          case "action":
            await this.host.runAction(m.actionId, m.args, m.entityId);
            this.ok(ws, m.id);
            await this.pushSnapshot();
            break;
          case "query": {
            const value = await this.host.queryPath(m.path, m.viewer);
            this.ok(ws, m.id, { value });
            break;
          }
          case "rewind":
            await this.host.engine.timeline.rewind(m.eventId);
            this.ok(ws, m.id);
            await this.pushSnapshot();
            break;
          case "branch": {
            if (!m.name) {
              this.err(ws, "INVALID", "error.branch_name_required", undefined, m.id);
              break;
            }
            await this.host.engine.timeline.switch(m.name);
            this.ok(ws, m.id, { branch: this.host.engine.timeline.current() });
            await this.pushSnapshot();
            break;
          }
          case "save": {
            const slot = await this.host.engine.timeline.save(m.label);
            this.ok(ws, m.id, { slot });
            break;
          }
          case "load":
            if (m.slot) await this.host.engine.timeline.load(m.slot);
            this.ok(ws, m.id);
            await this.pushSnapshot();
            break;
          case "list_saves": {
            const saves = await this.host.engine.timeline.saves();
            this.ok(ws, m.id, { saves });
            break;
          }
          case "config_get": {
            if (!this.hooks.configGet) {
              this.ok(ws, m.id, { config: {} });
              break;
            }
            const config = await this.hooks.configGet(m.keys);
            this.ok(ws, m.id, { config });
            break;
          }
          case "config_set": {
            if (!this.hooks.configSet) throw new Error("config_set not supported");
            const meta = await this.hooks.configSet(m.patch, m.consent);
            this.ok(ws, m.id, meta ?? undefined);
            if (meta?.reloadRecommended && !meta?.restarting) {
              this.broadcastLocalized((i18n) => ({
                v: WEB_PROTOCOL_VERSION,
                type: "toast",
                seq: this.nextSeq(),
                level: "warn",
                text: meta.message ?? i18n.t("config.reload_recommended"),
              }));
            }
            break;
          }
          case "models_probe": {
            if (!this.hooks.modelsProbe) {
              this.err(ws, "UNSUPPORTED", "error.unsupported", undefined, m.id);
              break;
            }
            const result = await this.hooks.modelsProbe(m.slot, m.draft);
            this.ok(ws, m.id, result);
            break;
          }
          case "images_probe": {
            if (!this.hooks.imagesProbe) {
              this.err(ws, "UNSUPPORTED", "error.unsupported", undefined, m.id);
              break;
            }
            const result = await this.hooks.imagesProbe(m.draft);
            this.ok(ws, m.id, result);
            break;
          }
          case "ollama_models": {
            if (!this.hooks.ollamaModels) {
              this.err(ws, "UNSUPPORTED", "error.unsupported", undefined, m.id);
              break;
            }
            const result = await this.hooks.ollamaModels(m.baseURL);
            this.ok(ws, m.id, result);
            break;
          }
          case "content_pack_notice": {
            if (!this.hooks.contentPackNotice) {
              this.err(ws, "UNSUPPORTED", "error.unsupported", undefined, m.id);
              break;
            }
            const notice = await this.hooks.contentPackNotice(m.packId);
            this.ok(ws, m.id, notice);
            break;
          }
          case "protagonist_set": {
            if (!this.hooks.protagonistSet) {
              this.err(ws, "UNSUPPORTED", "error.unsupported", undefined, m.id);
              break;
            }
            const result = await this.hooks.protagonistSet(m.name);
            this.ok(ws, m.id, result);
            if (result.ok) await this.pushSnapshot();
            break;
          }
          case "cancel":
            this.host.cancelActive(m.targetId ?? m.id);
            this.ok(ws, m.id, { cancelled: true });
            break;
          case "llm_log": {
            const log = this.host.engine.modelCallLog;
            if (!log) {
              this.ok(ws, m.id, { entries: [], enabled: false });
              break;
            }
            const limit = Math.min(m.limit ?? 50, 50);
            const entries = log.list({
              since: m.since,
              limit,
              label: m.label,
              slot: m.slot,
              errorsOnly: m.errorsOnly,
            });
            this.ok(ws, m.id, { entries, enabled: true, newestSeq: entries[0]?.seq ?? 0 });
            break;
          }
          case "llm_log_clear": {
            const log = this.host.engine.modelCallLog;
            if (log) log.clear();
            this.ok(ws, m.id, { cleared: true });
            break;
          }
          case "gallery_list": {
            const items = await this.host.galleryList({
              locale: ws.data.locale,
              includeLocked: m.includeLocked,
              includeUnavailable: m.includeUnavailable,
              debug: m.debug,
            });
            this.ok(ws, m.id, { gallery: items, generatorAvailable: this.host.galleryGeneratorAvailable() });
            break;
          }
          case "gallery_get": {
            const item = await this.host.galleryGet(m.entryId, {
              locale: ws.data.locale,
              includeLocked: m.includeLocked,
              includeUnavailable: m.includeUnavailable,
              debug: m.debug,
            });
            this.ok(ws, m.id, { gallery: item ?? null });
            break;
          }
          case "gallery_ratings": {
            this.ok(ws, m.id, { ratings: this.host.galleryRatings() });
            break;
          }
          case "gallery_jobs": {
            this.ok(ws, m.id, { jobs: this.host.galleryJobs(), generatorAvailable: this.host.galleryGeneratorAvailable() });
            break;
          }
          case "gallery_capture": {
            const out = await this.host.galleryCapture(m.req);
            this.ok(ws, m.id, out);
            await this.pushSnapshot();
            break;
          }
          case "gallery_render": {
            const out = await this.host.galleryRender(m.entryId, {
              reroll: m.reroll,
              seed: m.seed,
            });
            this.ok(ws, m.id, out);
            await this.pushSnapshot();
            break;
          }
          case "gallery_cancel": {
            const cancelled = await this.host.galleryCancel(m.job);
            this.ok(ws, m.id, { cancelled });
            break;
          }
          case "gallery_remove": {
            await this.host.galleryRemove(m.entryId);
            this.ok(ws, m.id, { removed: true });
            await this.pushSnapshot();
            break;
          }
          case "gallery_pin": {
            await this.host.galleryPin(m.entryId, m.pinned);
            this.ok(ws, m.id, { pinned: m.pinned });
            await this.pushSnapshot();
            break;
          }
          case "gallery_unlock": {
            if (!this.allowGalleryUnlock) {
              this.err(ws, "UNSUPPORTED", "error.unsupported", undefined, m.id);
              break;
            }
            const item = await this.host.galleryUnlock(m.entryId, m.source ? { source: m.source } : undefined);
            this.ok(ws, m.id, { gallery: item });
            await this.pushSnapshot();
            break;
          }
          default:
            this.err(ws, "UNKNOWN", "error.unknown");
        }
      });
    } catch (err) {
      const i18n = this.i18nFor(ws);
      const code = err instanceof AnimaeError ? err.code : "REQUEST_FAILED";
      const params = err instanceof AnimaeError ? err.params : undefined;
      const message =
        err instanceof AnimaeError ? err.localizedMessage(i18n.t.bind(i18n)) : err instanceof Error ? err.message : String(err);
      this.send(ws, {
        v: WEB_PROTOCOL_VERSION,
        type: "error",
        seq: this.nextSeq(),
        code,
        message,
        localized: err instanceof AnimaeError && Boolean(err.messageKey),
        params,
        id: "id" in m ? m.id : undefined,
      });
    }
  }
}
