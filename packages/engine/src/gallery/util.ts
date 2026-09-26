import type { ImageMime } from "../ports.ts";
import { AnimaeError } from "../types.ts";
import type { GalleryCollectionFile } from "./collection.ts";
import { sniffImageDimensions } from "./sniff.ts";

/** Max decoded image bytes accepted from ImagePort and served via RPC. */
export const MAX_GALLERY_IMAGE_BYTES = 12 * 1024 * 1024;

/** Orphan gallery image files older than this (mtime) may be deleted on startup. */
export const GALLERY_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

const FOCUS_MAX_LEN = 500;

/** Preset shipped art and other authored-relative paths must stay under the game root. */
export function isSafeAuthoredRelativePath(src: string): boolean {
  if (!src || src.startsWith("/") || src.includes("\\")) return false;
  const norm = src.replace(/\\/g, "/");
  if (norm.includes("..")) return false;
  return true;
}

export function sanitizeGalleryFocus(raw?: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  let s = String(raw).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (s.length > FOCUS_MAX_LEN) s = s.slice(0, FOCUS_MAX_LEN);
  return s.length ? s : undefined;
}

export function countImageIdRefs(data: GalleryCollectionFile, imageId: string): number {
  let n = 0;
  for (const rec of Object.values(data.presetImages)) {
    if (rec.id === imageId) n += 1;
  }
  for (const c of data.captured) {
    if (c.image?.id === imageId) n += 1;
  }
  return n;
}

export function validateGeneratedImageBytes(bytes: Uint8Array, declaredMime?: ImageMime): {
  mime: ImageMime;
  width: number;
  height: number;
} {
  if (!bytes?.length) {
    throw new AnimaeError("GALLERY_GENERATION_FAILED", "Image generator returned empty bytes");
  }
  if (bytes.length > MAX_GALLERY_IMAGE_BYTES) {
    throw new AnimaeError("GALLERY_GENERATION_FAILED", `Image exceeds maximum size (${MAX_GALLERY_IMAGE_BYTES} bytes)`);
  }
  const sniffed = sniffImageDimensions(bytes, declaredMime);
  if (!sniffed) {
    throw new AnimaeError("GALLERY_GENERATION_FAILED", "Image bytes are not a supported PNG, WebP, or JPEG");
  }
  return sniffed;
}
