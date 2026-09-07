import { gzipSync, brotliCompressSync } from "node:zlib";
import type { AssetEntry, AssetProvider } from "./types.ts";

export interface ServeAssetOptions {
  spaFallback?: string;
  cacheControl?: string;
}

export async function serveAssetRequest(
  provider: AssetProvider,
  pathname: string,
  req: Request,
  opts: ServeAssetOptions = {},
): Promise<Response> {
  let path = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (path === "ref" || path === "ref/") path = "ref/index.html";
  let entry = await provider.get(path);
  if (!entry && opts.spaFallback) {
    entry = await provider.get(opts.spaFallback.replace(/^\/+/, ""));
  }
  if (!entry) return new Response("Not Found", { status: 404 });

  const accept = req.headers.get("accept-encoding") ?? "";
  let body: Uint8Array = entry.body;
  const headers = new Headers({
    "content-type": entry.contentType,
    etag: entry.etag,
    "cache-control": opts.cacheControl ?? "public, max-age=3600",
    "x-content-type-options": "nosniff",
  });

  const inm = req.headers.get("if-none-match");
  if (inm && inm === entry.etag) {
    return new Response(null, { status: 304, headers });
  }

  if (body.length > 256 && accept.includes("br")) {
    body = brotliCompressSync(body);
    headers.set("content-encoding", "br");
  } else if (body.length > 256 && accept.includes("gzip")) {
    body = gzipSync(body);
    headers.set("content-encoding", "gzip");
  }
  headers.set("content-length", String(body.length));
  return new Response(body, { status: 200, headers });
}
