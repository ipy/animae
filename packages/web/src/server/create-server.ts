import type { Server } from "bun";
import type { SessionHost } from "@animae/host";
import { randomUUID } from "node:crypto";
import type { AssetProvider } from "../assets/types.ts";
import { serveAssetRequest } from "../assets/serve-asset.ts";
import { WEB_PROTOCOL_VERSION } from "../protocol/version.ts";
import {
  checkOrigin,
  extractToken,
  resolveSecurityConfig,
  tokenFromCookie,
  type WebSecurityConfig,
} from "./security.ts";
import { SessionRoom, type WebSessionHooks } from "./session-room.ts";

interface WsData {
  id: string;
  role: "controller" | "spectator";
  authenticated: boolean;
  messageTimes: number[];
}

export interface CreateWebServerOptions {
  host: SessionHost;
  port: number;
  bindHost?: string;
  assets: AssetProvider;
  authToken?: string;
  extraOrigins?: string[];
  hooks?: WebSessionHooks;
  version?: string;
  onListen?: (info: { url: string; token?: string }) => void;
}

export interface WebServerHandle {
  server: Server<WsData>;
  security: WebSecurityConfig;
  room: SessionRoom;
  url: string;
  stop(): void;
}

export function createWebServer(opts: CreateWebServerOptions): WebServerHandle {
  const bindHost = opts.bindHost ?? "127.0.0.1";
  const security = resolveSecurityConfig({
    host: bindHost,
    token: opts.authToken,
    port: opts.port,
    extraOrigins: opts.extraOrigins,
  });

  const sessionId = randomUUID();
  const room = new SessionRoom(sessionId, opts.host, security, opts.hooks ?? {});

  const heartbeatMs = 30_000;
  const server = Bun.serve<WsData>({
    hostname: bindHost,
    port: opts.port,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (security.authToken) {
        const token =
          extractToken(req, url) ?? tokenFromCookie(req.headers.get("cookie"));
        if (token !== security.authToken) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      if (url.pathname === "/api/health") {
        return Response.json({ ok: true, sessionId });
      }
      if (url.pathname === "/api/version") {
        return Response.json({
          protocol: WEB_PROTOCOL_VERSION,
          package: "@animae/web",
          app: opts.version ?? "unknown",
        });
      }

      const origin = req.headers.get("origin");
      if (origin && !checkOrigin(origin, security.allowedOrigins)) {
        return new Response("Forbidden origin", { status: 403 });
      }

      if (url.pathname === "/ws") {
        if (req.headers.get("upgrade") !== "websocket") {
          return new Response("Expected WebSocket", { status: 426 });
        }
        const upgraded = server.upgrade(req, {
          data: {
            id: randomUUID(),
            role: "spectator" as const,
            authenticated: false,
            messageTimes: [] as number[],
          },
        });
        if (!upgraded) return new Response("WebSocket upgrade failed", { status: 500 });
        return undefined as unknown as Response;
      }

      const csp =
        "default-src 'self'; connect-src 'self' ws: wss:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'";
      const res = await serveAssetRequest(opts.assets, url.pathname, req, { spaFallback: "index.html" });
      res.headers.set("content-security-policy", csp);
      res.headers.set("x-frame-options", "DENY");
      res.headers.set("referrer-policy", "same-origin");
      return res;
    },
    websocket: {
      maxPayloadLength: security.maxMessageBytes,
      idleTimeout: 120,
      open(ws) {
        room.registerClient(ws, ws.data.id);
        const timer = setInterval(() => {
          try {
            ws.send(JSON.stringify({ v: WEB_PROTOCOL_VERSION, type: "heartbeat", seq: 0 }));
          } catch {
            clearInterval(timer);
          }
        }, heartbeatMs);
        (ws as unknown as { __hb: NodeJS.Timeout }).__hb = timer;
      },
      close(ws) {
        const t = (ws as unknown as { __hb?: NodeJS.Timeout }).__hb;
        if (t) clearInterval(t);
        room.removeClient(ws.data.id);
      },
      message(ws, message) {
        const raw = typeof message === "string" ? message : message;
        const size =
          typeof raw === "string" ? raw.length : raw.byteLength ?? raw.length;
        if (size > security.maxMessageBytes) {
          ws.close(1009, "message too large");
          return;
        }
        void room.handleMessage(ws, raw);
      },
    },
  });

  const displayHost = bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost;
  const url = `http://${displayHost}:${opts.port}/`;
  const tokenQuery = security.authToken ? `?token=${encodeURIComponent(security.authToken)}` : "";
  opts.onListen?.({ url: url + tokenQuery, token: security.authToken });

  return {
    server,
    security,
    room,
    url: url + tokenQuery,
    stop() {
      room.close();
      server.stop();
    },
  };
}
