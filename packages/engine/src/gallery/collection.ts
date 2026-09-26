import type { StoragePort } from "../ports.ts";
import type { ImageMime } from "../ports.ts";
import { sha256Hex } from "../store/util.ts";
import { sniffImageDimensions } from "./sniff.ts";
import type { GalleryJobState } from "./types.ts";

export const COLLECTION_PATH = "gallery/collection.json";
export const IMAGES_DIR = "gallery/images";

export interface StoredImageRecord {
  id: string;
  path: string;
  mime: ImageMime;
  width: number;
  height: number;
  bytes: number;
  generator?: string;
  seed?: number;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface StoredCaptureContext {
  sceneId?: string;
  location?: string;
  locationText?: string;
  characters: string[];
  focus?: string;
  utterances?: string[];
}

export interface StoredCapturedEntry {
  id: string;
  title: string;
  caption?: string;
  lang?: string;
  rating: string;
  characters: string[];
  location?: string;
  tags: string[];
  pinned?: boolean;
  image?: StoredImageRecord;
  brief?: Record<string, unknown>;
  briefTier?: "s1" | "s2";
  context?: StoredCaptureContext;
  createdAt: string;
}

export interface StoredUnlockRecord {
  day: number;
  minute: number;
  branch?: string;
  at: string;
}

export interface StoredJobRecord {
  id: string;
  item: string;
  state: GalleryJobState;
  progress?: number;
  error?: { code: string; message: string };
  startedAt?: string;
  finishedAt?: string;
}

export interface GalleryCollectionFile {
  version: 1;
  unlocks: Record<string, StoredUnlockRecord>;
  /** preset id -> generated image (not shipped art) */
  presetImages: Record<string, StoredImageRecord>;
  captured: StoredCapturedEntry[];
  /** persisted in-flight jobs for restart reconciliation */
  jobs: StoredJobRecord[];
}

export function emptyCollection(): GalleryCollectionFile {
  return { version: 1, unlocks: {}, presetImages: {}, captured: [], jobs: [] };
}

export function imageIdFromBytes(bytes: Uint8Array): string {
  return sha256Hex(bytes).slice(0, 16);
}

export function imageStoragePath(id: string, mime: ImageMime): string {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `${IMAGES_DIR}/${id}.${ext}`;
}

/** Serialized writer for collection.json (single-flight mutations). */
export class GalleryCollectionStore {
  private writeChain: Promise<void> = Promise.resolve();
  private data: GalleryCollectionFile = emptyCollection();
  private loaded = false;
  private readonly storage: StoragePort;
  private readonly now: () => string;

  constructor(storage: StoragePort, now: () => string) {
    this.storage = storage;
    this.now = now;
  }

  async load(): Promise<GalleryCollectionFile> {
    if (this.loaded) return this.data;
    const text = await this.storage.readText(COLLECTION_PATH);
    if (text === undefined) {
      this.data = emptyCollection();
      this.loaded = true;
      return this.data;
    }
    try {
      const parsed = JSON.parse(text) as GalleryCollectionFile & { version?: number };
      const ver = parsed.version;
      if (ver === undefined || typeof parsed.unlocks !== "object") throw new Error("bad version");
      if (typeof ver === "number" && ver > 1) {
        // Forward-compatible read: keep known fields; do not discard data from newer writers.
      } else if (ver !== 1) {
        throw new Error("bad version");
      }
      this.data = {
        version: 1,
        unlocks: parsed.unlocks ?? {},
        presetImages: parsed.presetImages ?? {},
        captured: Array.isArray(parsed.captured) ? parsed.captured : [],
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      };
    } catch {
      const ts = Date.now().toString(36);
      const corruptPath = `${COLLECTION_PATH}.corrupt-${ts}`;
      await this.storage.writeAtomic(corruptPath, text);
      this.data = await this.rebuildFromImages();
      await this.persist();
    }
    this.loaded = true;
    return this.data;
  }

  snapshot(): GalleryCollectionFile {
    return structuredClone(this.data);
  }

  mutate(fn: (draft: GalleryCollectionFile) => void | Promise<void>): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      if (!this.loaded) await this.load();
      const draft = structuredClone(this.data);
      await fn(draft);
      this.data = draft;
      await this.persist();
    });
    return this.writeChain;
  }

  private async persist(): Promise<void> {
    await this.storage.writeAtomic(COLLECTION_PATH, JSON.stringify(this.data, null, 2));
  }

  private async rebuildFromImages(): Promise<GalleryCollectionFile> {
    const base = emptyCollection();
    const files = await this.storage.listFiles(IMAGES_DIR);
    for (const path of files) {
      const bytes = await this.storage.readBytes(path);
      if (!bytes?.length) continue;
      const info = sniffImageDimensions(bytes);
      if (!info) continue;
      const id = path.split("/").pop()?.replace(/\.(png|webp|jpe?g)$/i, "") ?? "";
      if (!id) continue;
      base.captured.push({
        id: `cap-${id.slice(0, 8)}`,
        title: "",
        rating: "general",
        characters: [],
        tags: [],
        createdAt: this.now(),
        image: {
          id,
          path,
          mime: info.mime,
          width: info.width,
          height: info.height,
          bytes: bytes.length,
          createdAt: this.now(),
        },
      });
    }
    return base;
  }
}
