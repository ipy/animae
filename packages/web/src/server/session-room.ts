import type { ServerWebSocket } from "bun";
import type { SessionHost } from "@animae/host";
import { AnimaeError, type EngineEvent } from "@animae/engine";
import { ClientMessageSchema, type ServerMessage } from "../protocol/schemas.ts";
import { diffSnapshot } from "./snapshot-diff.ts";
import { WEB_PROTOCOL_VERSION } from "../protocol/version.ts";
import type { WebSecurityConfig } from "./security.ts";

export type ClientRole = "controller" | "spectator";

export interface WebSessionHooks {
  configGet?(keys?: string[]): Promise<Record<string, unknown>>;
  configSet?(
    patch: Record<string, unknown>,
    consent?: { packId: string; phrase: string; noticeVersion: string },
  ): Promise<{ reloadRecommended?: boolean; message?: string } | void>;
  modelsProbe?(slot?: "s1" | "s2"): Promise<Record<string, unknown>>;
  ollamaModels?(baseURL?: string): Promise<{ ok: boolean; models?: string[]; error?: string }>;
  contentPackNotice?(packId: string): Promise<{ notice: string; noticeVersion?: string }>;
}

interface WsData {
  id: string;
  role: ClientRole;
  authenticated: boolean;
  messageTimes: number[];
}

export class SessionRoom {
  readonly sessionId: string;
  readonly host: SessionHost;
  readonly security: WebSecurityConfig;
  readonly hooks: WebSessionHooks;

  private seq = 0;
  private controllerId?: string;
  private readonly clients = new Map<string, ServerWebSocket<WsData>>();
  private readonly patchBuffer: ServerMessage[] = [];
  private readonly patchBufferLimit = 500;
  private lastSnapshotState?: Record<string, unknown>;
  private engineUnsubs: Array<() => void> = [];

  constructor(sessionId: string, host: SessionHost, security: WebSecurityConfig, hooks: WebSessionHooks = {}) {
    this.sessionId = sessionId;
    this.host = host;
    this.security = security;
    this.hooks = hooks;
    this.host.setStreamCallbacks({
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
        void this.pushSnapshot();
      },
      onToast: (level, text) => {
        this.broadcast({
          v: WEB_PROTOCOL_VERSION,
          type: "toast",
          seq: this.nextSeq(),
          level,
          text,
        });
      },
      onBusy: (active, requestId) => {
        this.broadcast({
          v: WEB_PROTOCOL_VERSION,
          type: "busy",
          seq: this.nextSeq(),
          active,
          requestId,
        });
      },
      onStateChange: () => {
        void this.pushSnapshot();
      },
    });

    const off = this.host.engine.on("*", (e: EngineEvent) => {
      this.broadcast({
        v: WEB_PROTOCOL_VERSION,
        type: "event",
        seq: this.nextSeq(),
        kind: e.kind,
        payload: e,
      });
    });
    this.engineUnsubs.push(off);
  }

  close(): void {
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
    if (msg.type === "snapshot" || msg.type === "patch" || msg.type === "stream" || msg.type === "event") {
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

  async pushSnapshot(forceFull = false): Promise<void> {
    const state = await this.host.buildSnapshot();
    if (!forceFull && this.lastSnapshotState) {
      const ops = diffSnapshot(this.lastSnapshotState, state);
      if (ops) {
        this.lastSnapshotState = state;
        this.broadcast({
          v: WEB_PROTOCOL_VERSION,
          type: "patch",
          seq: this.nextSeq(),
          ops,
        });
        return;
      }
    }
    this.lastSnapshotState = state;
    this.broadcast({
      v: WEB_PROTOCOL_VERSION,
      type: "snapshot",
      seq: this.nextSeq(),
      state,
    });
  }

  replaySince(seq: number, ws: ServerWebSocket<WsData>): void {
    for (const msg of this.patchBuffer) {
      if ("seq" in msg && typeof msg.seq === "number" && msg.seq > seq) {
        ws.send(JSON.stringify(msg));
      }
    }
  }

  registerClient(ws: ServerWebSocket<WsData>, id: string): void {
    this.clients.set(id, ws);
  }

  removeClient(id: string): void {
    if (this.controllerId === id) this.controllerId = undefined;
    this.clients.delete(id);
  }

  private rateLimit(data: WsData): boolean {
    const now = Date.now();
    data.messageTimes = data.messageTimes.filter((t) => now - t < 60_000);
    if (data.messageTimes.length >= this.security.maxMessagesPerMinute) return false;
    data.messageTimes.push(now);
    return true;
  }

  private err(ws: ServerWebSocket<WsData>, code: string, message: string, id?: string): void {
    this.send(ws, {
      v: WEB_PROTOCOL_VERSION,
      type: "error",
      seq: this.nextSeq(),
      code,
      message,
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

  async handleMessage(ws: ServerWebSocket<WsData>, raw: string | Buffer): Promise<void> {
    const data = ws.data;
    if (!this.rateLimit(data)) {
      this.err(ws, "RATE_LIMIT", "Too many messages");
      ws.close(1008, "rate limit");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
    } catch {
      this.err(ws, "PARSE", "Invalid JSON");
      return;
    }

    const msg = ClientMessageSchema.safeParse(parsed);
    if (!msg.success) {
      this.err(ws, "INVALID_MESSAGE", msg.error.message);
      return;
    }

    const m = msg.data;

    if (m.type === "hello") {
      if (this.security.authToken && m.token !== this.security.authToken) {
        this.err(ws, "AUTH", "Invalid token");
        ws.close(1008, "auth");
        return;
      }
      const role = m.role ?? "spectator";
      if (role === "controller") {
        if (this.controllerId && this.controllerId !== data.id) {
          this.err(ws, "CONTROLLER_TAKEN", "Another controller is active");
          data.role = "spectator";
        } else {
          this.controllerId = data.id;
          data.role = "controller";
        }
      } else {
        data.role = "spectator";
      }
      data.authenticated = true;
      this.send(ws, {
        v: WEB_PROTOCOL_VERSION,
        type: "hello_ok",
        seq: this.nextSeq(),
        sessionId: this.sessionId,
        role: data.role,
        controllerPresent: Boolean(this.controllerId),
        protocolVersion: WEB_PROTOCOL_VERSION,
      });
      await this.pushSnapshot();
      if (typeof m.resumeSeq === "number") this.replaySince(m.resumeSeq, ws);
      return;
    }

    if (!data.authenticated) {
      this.err(ws, "HELLO_REQUIRED", "Send hello first");
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
      "ollama_models",
      "content_pack_notice",
    ]);
    if (needsControl.has(m.type) && data.role !== "controller") {
      this.err(ws, "READ_ONLY", "Spectators cannot control the session", "id" in m ? m.id : undefined);
      return;
    }

    try {
      switch (m.type) {
        case "ping":
          this.send(ws, { v: WEB_PROTOCOL_VERSION, type: "pong", seq: this.nextSeq(), id: m.id });
          break;
        case "get_state": {
          const state = await this.host.buildSnapshot();
          this.ok(ws, m.id, { state });
          break;
        }
        case "select_focus":
          this.host.selectFocus(m.entityId);
          await this.pushSnapshot();
          if (m.id) this.ok(ws, m.id);
          break;
        case "input":
          await this.host.submitInput(m.text, m.choiceId, m.id);
          this.ok(ws, m.id);
          break;
        case "choose":
          await this.host.submitInput("", m.choiceId, m.id);
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
            this.err(ws, "INVALID", "branch requires name", m.id);
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
          if (meta?.reloadRecommended) {
            this.broadcast({
              v: WEB_PROTOCOL_VERSION,
              type: "toast",
              seq: this.nextSeq(),
              level: "warn",
              text: meta.message ?? "Configuration saved; reload recommended.",
            });
          }
          break;
        }
        case "models_probe": {
          if (!this.hooks.modelsProbe) {
            this.err(ws, "UNSUPPORTED", "models_probe not available", m.id);
            break;
          }
          const result = await this.hooks.modelsProbe(m.slot);
          this.ok(ws, m.id, result);
          break;
        }
        case "ollama_models": {
          if (!this.hooks.ollamaModels) {
            this.err(ws, "UNSUPPORTED", "ollama_models not available", m.id);
            break;
          }
          const result = await this.hooks.ollamaModels(m.baseURL);
          this.ok(ws, m.id, result);
          break;
        }
        case "content_pack_notice": {
          if (!this.hooks.contentPackNotice) {
            this.err(ws, "UNSUPPORTED", "content_pack_notice not available", m.id);
            break;
          }
          const notice = await this.hooks.contentPackNotice(m.packId);
          this.ok(ws, m.id, notice);
          break;
        }
        case "cancel":
          this.host.cancelActive(m.targetId ?? m.id);
          this.ok(ws, m.id, { cancelled: true });
          break;
        default:
          this.err(ws, "UNKNOWN", "Unhandled message type");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof AnimaeError ? err.code : "REQUEST_FAILED";
      this.err(ws, code, message, "id" in m ? m.id : undefined);
    }
  }
}
