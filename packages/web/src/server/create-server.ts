import type { Server } from "bun";
import type { SessionHost } from "@animae/host";
import { randomUUID } from "node:crypto";
import type { AssetProvider } from "../assets/types.ts";
import { serveAssetRequest } from "../assets/serve-asset.ts";
import { localizeValue, matchAvailableLocale } from "@animae/i18n";
import { WEB_PROTOCOL_VERSION } from "../protocol/version.ts";
import { WEB_SUPPORTED_LOCALES, createWebI18n } from "../i18n/web-i18n.ts";
import {
  checkOrigin,
  extractToken,
  resolveSecurityConfig,
  tokenFromCookie,
  type WebSecurityConfig,
} from "./security.ts";
import { SessionRoom, type WebSessionHooks } from "./session-room.ts";
import {
  defaultGalleryImagePolicy,
  serveGalleryImageRequest,
  type GalleryImagePolicyFn,
} from "./gallery-image.ts";

interface WsData {
  id: string;
  clientId: string;
  role: "controller" | "spectator";
  authenticated: boolean;
  messageTimes: number[];
  locale: string;
}

export interface WebGalleryServerOptions {
  /** Authored default rating id (Cache-Control policy fallback). */
  defaultRating?: string;
  /** Per-item cache policy for HTTP image responses. */
  galleryImagePolicy?: GalleryImagePolicyFn;
  /** Allow `gallery_unlock` over the WebSocket (debug / dev). */
  allowGalleryUnlock?: boolean;
}

export interface CreateWebServerOptions {
  host: SessionHost;
  port: number;
  bindHost?: string;
  assets: AssetProvider;
  authToken?: string;
  extraOrigins?: string[];
  hooks?: WebSessionHooks;
  gallery?: WebGalleryServerOptions;
  /** Optional authenticated `/api/*` handler before built-in gallery routes. */
  onApiRequest?: (req: Request, url: URL) => Promise<Response | undefined>;
  version?: string;
  onListen?: (info: { url: string; token?: string }) => void;
}

export interface WebServerHandle {
  server: Server<WsData>;
  security: WebSecurityConfig;
  room: SessionRoom;
  url: string;
  stop(): void;
  pushGalleryNotice(notice: import("@animae/engine").GalleryNotice): void;
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
  const defaultRating = opts.gallery?.defaultRating ?? "general";
  const imagePolicy = opts.gallery?.galleryImagePolicy ?? defaultGalleryImagePolicy(defaultRating);
  const room = new SessionRoom(sessionId, opts.host, security, opts.hooks ?? {}, {
    allowGalleryUnlock: opts.gallery?.allowGalleryUnlock ?? false,
  });

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

      if (url.pathname === "/api/environment") {
        const hook = room.hooks.environment;
        if (!hook) {
          return new Response("Not Found", { status: 404 });
        }
        const locale = matchAvailableLocale(url.searchParams.get("locale") ?? "en", WEB_SUPPORTED_LOCALES);
        const t = createWebI18n(locale).t;
        const raw = await hook();
        const entries = raw.map((entry) => ({
          id: entry.id,
          value: entry.value,
          kind: entry.kind,
          label:
            entry.label == null
              ? entry.id
              : typeof entry.label === "string"
                ? entry.label
                : String(localizeValue(entry.label, t)),
        }));
        return Response.json({ entries });
      }

      if (opts.onApiRequest) {
        const custom = await opts.onApiRequest(req, url);
        if (custom) return custom;
      }

      if (url.pathname.startsWith("/api/gallery/image/")) {
        return serveGalleryImageRequest(req, url, opts.host, imagePolicy);
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
            clientId: randomUUID(),
            role: "spectator" as const,
            authenticated: false,
            messageTimes: [] as number[],
            locale: "en",
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
    pushGalleryNotice(notice) {
      room.emitGalleryNotice(notice);
    },
    stop() {
      room.close();
      server.stop();
    },
  };
}
