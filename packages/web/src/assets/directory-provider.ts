import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import type { AssetEntry, AssetProvider } from "./types.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function safeRel(root: string, urlPath: string): string | null {
  const cleaned = urlPath.replace(/^\/+/, "").split("?")[0] ?? "";
  const abs = normalize(join(root, cleaned));
  const rootNorm = normalize(root);
  if (!abs.startsWith(rootNorm + sep) && abs !== rootNorm) return null;
  return abs;
}

function contentType(file: string): string {
  const ext = file.includes(".") ? file.slice(file.lastIndexOf(".")) : "";
  return MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

export function createDirectoryAssetProvider(rootDir: string): AssetProvider {
  return {
    label: rootDir,
    async get(urlPath: string): Promise<AssetEntry | null> {
      const abs = safeRel(rootDir, urlPath);
      if (!abs) return null;
      try {
        const st = await stat(abs);
        if (!st.isFile()) return null;
        const body = new Uint8Array(await readFile(abs));
        const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
        return { body, contentType: contentType(abs), etag, modified: st.mtimeMs };
      } catch {
        return null;
      }
    },
  };
}
