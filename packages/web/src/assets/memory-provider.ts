import { createHash } from "node:crypto";
import type { AssetEntry, AssetProvider } from "./types.ts";

function decodeAssetBody(body: Uint8Array | string, contentType: string): { body: Uint8Array; contentType: string } {
  if (body instanceof Uint8Array) return { body, contentType };
  const base64 = contentType.includes("encoding=base64");
  const mediaType = base64 ? contentType.replace(/;\s*encoding=base64/i, "").trim() : contentType;
  if (base64) {
    return { body: Uint8Array.from(Buffer.from(body, "base64")), contentType: mediaType };
  }
  return { body: new TextEncoder().encode(body), contentType: mediaType };
}

export function createMemoryAssetProvider(
  files: Record<string, { body: Uint8Array | string; contentType: string }>,
): AssetProvider {
  const normalized = new Map<string, AssetEntry>();
  for (const [path, file] of Object.entries(files)) {
    const key = path.replace(/^\/+/, "");
    const { body, contentType } = decodeAssetBody(file.body, file.contentType);
    const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
    normalized.set(key, { body, contentType, etag });
  }
  return {
    label: "embedded",
    async get(urlPath: string): Promise<AssetEntry | null> {
      const key = urlPath.replace(/^\/+/, "").split("?")[0] ?? "";
      return normalized.get(key) ?? null;
    },
  };
}
