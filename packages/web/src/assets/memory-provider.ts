import { createHash } from "node:crypto";
import type { AssetEntry, AssetProvider } from "./types.ts";

export function createMemoryAssetProvider(
  files: Record<string, { body: Uint8Array | string; contentType: string }>,
): AssetProvider {
  const normalized = new Map<string, AssetEntry>();
  for (const [path, file] of Object.entries(files)) {
    const key = path.replace(/^\/+/, "");
    const body = typeof file.body === "string" ? new TextEncoder().encode(file.body) : file.body;
    const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
    normalized.set(key, { body, contentType: file.contentType, etag });
  }
  return {
    label: "embedded",
    async get(urlPath: string): Promise<AssetEntry | null> {
      const key = urlPath.replace(/^\/+/, "").split("?")[0] ?? "";
      return normalized.get(key) ?? null;
    },
  };
}
