import type { ImageMime } from "../ports.ts";

/** Stable gallery-related AnimaeError codes (developer-facing messages). */
export const GALLERY_ERROR_CODES = [
  "GALLERY_NO_GENERATOR",
  "GALLERY_UNKNOWN_ENTRY",
  "GALLERY_LOCKED",
  "GALLERY_RATING_UNAVAILABLE",
  "GALLERY_BUSY",
  "GALLERY_BRIEF_INVALID",
  "GALLERY_GENERATION_FAILED",
] as const;

export type GalleryErrorCode = (typeof GALLERY_ERROR_CODES)[number];

export type GalleryItemKind = "preset" | "captured";

export type GalleryJobState = "queued" | "briefing" | "rendering" | "storing" | "done" | "failed" | "cancelled";

export interface GalleryImageRef {
  id: string;
  path: string;
  mime: ImageMime;
  width: number;
  height: number;
  bytes: number;
  generator?: string;
  seed?: number;
  createdAt?: string;
}

export interface GalleryJobView {
  id: string;
  item: string;
  state: GalleryJobState;
  progress?: number;
  error?: { code: string; message: string };
  startedAt?: string;
  finishedAt?: string;
}

export interface GalleryItemView {
  id: string;
  kind: GalleryItemKind;
  title: string;
  caption?: string;
  hint?: string;
  group?: string;
  order: number;
  rating: string;
  available: boolean;
  unlocked: boolean;
  unlockedAt?: { day: number; minute: number; branch?: string; at: string };
  characters: string[];
  location?: string;
  tags: string[];
  image?: GalleryImageRef;
  job?: GalleryJobView;
  lang?: string;
  pinned?: boolean;
  debug?: { prompt?: string; negative?: string; seed?: number; brief?: unknown };
}

export interface GalleryRatingView {
  id: string;
  label: string;
  available: boolean;
}

export interface GalleryListOptions {
  locale?: string;
  /** default true */
  includeLocked?: boolean;
  /** default false */
  includeUnavailable?: boolean;
  debug?: boolean;
}

export interface GalleryCaptureRequest {
  focus?: string;
  rating?: string;
  characters?: string[];
  tier?: "s1" | "s2";
  title?: string;
  seed?: number;
}

export type GalleryNotice =
  | { type: "unlocked"; item: string }
  | { type: "job"; job: GalleryJobView }
  | { type: "changed"; item: string };

export interface GalleryLifecycleHooks {
  afterTurn?(turnKinds: string[], event?: { type?: string; tags?: string[]; intensity?: number; sincerity?: number }): Promise<void>;
  afterSceneEnd?(): Promise<void>;
  afterWorldChange?(): Promise<void>;
  close?(): Promise<void>;
}

export interface GalleryService {
  /** True when an ImagePort is wired (render/capture can work). Presets with shipped art are viewable regardless. */
  generatorAvailable(): boolean;
  ratings(): GalleryRatingView[];
  list(opts?: GalleryListOptions): Promise<GalleryItemView[]>;
  get(id: string, opts?: GalleryListOptions): Promise<GalleryItemView | undefined>;
  unlock(id: string, why?: { source?: string }): Promise<GalleryItemView>;
  capture(req?: GalleryCaptureRequest): Promise<{ item: string; job: string }>;
  render(id: string, opts?: { reroll?: boolean; seed?: number }): Promise<{ job: string }>;
  cancel(job: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  pin(id: string, pinned: boolean): Promise<void>;
  image(id: string): Promise<{ bytes: Uint8Array; ref: GalleryImageRef } | undefined>;
  jobs(): GalleryJobView[];
  subscribe(handler: (n: GalleryNotice) => void): () => void;
}
