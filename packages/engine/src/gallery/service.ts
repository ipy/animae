import { randomBytes } from "node:crypto";
import type { Kernel } from "../contracts.ts";
import type { ImagePort, ImageRequest } from "../ports.ts";
import { AnimaeError } from "../types.ts";
import type { Appraisal } from "../events.ts";
import type { GalleryConfig, GalleryPresetEntry } from "../schema/gallery.ts";
import { GalleryConfigSchema } from "../schema/gallery.ts";
import { composeGalleryPrompts } from "./compose.ts";
import { buildCgBriefPrompt } from "./brief-prompt.ts";
import { CgBriefOutputSchema } from "./brief-schema.ts";
import {
  GalleryCollectionStore,
  IMAGES_DIR,
  imageIdFromBytes,
  imageStoragePath,
  type StoredCapturedEntry,
  type StoredImageRecord,
  type StoredJobRecord,
} from "./collection.ts";
import { entityDisplayName } from "../entities/names.ts";
import { galleryCelContext } from "./cel-extra.ts";
import { sniffImageDimensions } from "./sniff.ts";
import type {
  GalleryCaptureRequest,
  GalleryItemView,
  GalleryJobView,
  GalleryListOptions,
  GalleryNotice,
  GalleryRatingView,
  GalleryService,
  GalleryLifecycleHooks,
} from "./types.ts";
import {
  countImageIdRefs,
  GALLERY_ORPHAN_GRACE_MS,
  isSafeAuthoredRelativePath,
  sanitizeGalleryFocus,
  validateGeneratedImageBytes,
} from "./util.ts";
import type { GalleryCollectionFile, StoredCaptureContext } from "./collection.ts";

const MAX_PENDING = 8;
const ACTIVE_JOB_STATES = new Set(["queued", "briefing", "rendering", "storing"]);

export function createGalleryService(
  k: Kernel,
  imagePort: ImagePort | undefined,
  opts?: { now?: () => string },
): GalleryService & GalleryLifecycleHooks {
  const wallNow = opts?.now ?? (() => new Date().toISOString());
  const store = new GalleryCollectionStore(k.storage, wallNow);
  const subscribers = new Set<(n: GalleryNotice) => void>();
  const liveJobs = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  const jobQueue: string[] = [];
  const jobRenderOpts = new Map<string, { seed?: number; reroll?: boolean }>();
  let queueRunning = false;
  let shuttingDown = false;
  let jobSeq = 0;
  const unlockCelLogged = new Set<string>();

  void store.load().then(async () => {
    await reconcileInterrupted();
    await cleanupOrphanImages();
  });

  function config(): GalleryConfig | undefined {
    const raw = k.authored.config.gallery;
    if (!raw) return undefined;
    const parsed = GalleryConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  function galleryEnabled(): boolean {
    const cfg = config();
    if (!cfg) return false;
    if (cfg.enabled === false) return false;
    if (Object.keys(cfg.entries).length > 0) return true;
    return imagePort !== undefined;
  }

  function unlockedIds(): string[] {
    const snap = store.snapshot();
    return [...Object.keys(snap.unlocks)];
  }

  function ratingAvailable(
    ratingId: string,
    turnKinds: string[] = [],
    event?: Partial<Appraisal> & { type?: string; text?: string },
  ): boolean {
    const cfg = config();
    if (!cfg) return false;
    const def = cfg.ratings[ratingId];
    if (!def) return ratingId === cfg.defaultRating;
    const ctx = galleryCelContext(k, imagePort, unlockedIds(), turnKinds, {
      event: event ? { type: event.type, text: event.text, tags: event.tags, intensity: event.intensity, sincerity: event.sincerity } : undefined,
      sceneId: k.timeline.state().scene?.id,
    });
    try {
      return k.rules.cel.bool(def.when, ctx);
    } catch {
      return false;
    }
  }

  function itemRatingId(itemId: string): string | undefined {
    const cfg = config();
    if (!cfg) return undefined;
    if (cfg.entries[itemId]) return cfg.entries[itemId]!.rating || cfg.defaultRating;
    const cap = store.snapshot().captured.find((c) => c.id === itemId);
    return cap?.rating;
  }

  function itemVisibleToSubscriber(itemId: string): boolean {
    const rid = itemRatingId(itemId);
    if (!rid) return true;
    return ratingAvailable(rid);
  }

  function notify(n: GalleryNotice): void {
    if (n.type === "unlocked" || n.type === "changed") {
      if (!itemVisibleToSubscriber(n.item)) return;
    }
    if (n.type === "job" && !itemVisibleToSubscriber(n.job.item)) return;
    for (const h of subscribers) h(n);
  }

  function jobView(rec: StoredJobRecord): GalleryJobView {
    return {
      id: rec.id,
      item: rec.item,
      state: rec.state,
      progress: rec.progress,
      error: rec.error,
      startedAt: rec.startedAt,
      finishedAt: rec.finishedAt,
    };
  }

  async function reconcileInterrupted(): Promise<void> {
    await store.mutate((d) => {
      for (const j of d.jobs) {
        if (ACTIVE_JOB_STATES.has(j.state) && !liveJobs.has(j.id)) {
          j.state = "failed";
          j.error = { code: "interrupted", message: "Gallery job interrupted by restart" };
          j.finishedAt = wallNow();
        }
      }
    });
  }

  async function cleanupOrphanImages(): Promise<void> {
    const snap = store.snapshot();
    const referenced = new Set<string>();
    for (const rec of Object.values(snap.presetImages)) {
      if (rec.path.startsWith(IMAGES_DIR)) referenced.add(rec.path);
    }
    for (const c of snap.captured) {
      if (c.image?.path.startsWith(IMAGES_DIR)) referenced.add(c.image.path);
    }
    const files = await k.storage.listFiles(IMAGES_DIR);
    const cutoff = Date.now() - GALLERY_ORPHAN_GRACE_MS;
    for (const path of files) {
      if (referenced.has(path)) continue;
      const st = await k.storage.stat(path);
      if (!st || st.mtimeMs > cutoff) continue;
      await k.storage.remove(path).catch(() => undefined);
    }
  }

  async function removeImageFileIfUnreferenced(data: GalleryCollectionFile, imageId: string, path: string): Promise<void> {
    if (!path.startsWith(IMAGES_DIR)) return;
    if (countImageIdRefs(data, imageId) > 0) return;
    await k.storage.remove(path).catch(() => undefined);
  }

  function hasLockedRulePresets(): boolean {
    const cfg = config();
    if (!cfg) return false;
    const snap = store.snapshot();
    return Object.entries(cfg.entries).some(([id, e]) => !snap.unlocks[id] && Boolean(e.unlock?.when));
  }

  function snapshotCaptureContext(focus?: string, characters?: string[]): StoredCaptureContext {
    const scene = k.timeline.state().scene;
    const locId = scene?.location;
    const locText = locId ? k.catalog.location(locId)?.name ?? locId : undefined;
    const participants = characters?.length ? characters : scene?.participants ?? [];
    return {
      sceneId: scene?.id,
      location: locId,
      locationText: locText,
      characters: [...participants],
      focus,
    };
  }

  function resolveDisplay(value: unknown, locale: string): string {
    const resolved = k.displayText?.resolve(locale, value, { localizeNames: true }) ?? value;
    if (typeof resolved === "string") return resolved;
    if (resolved && typeof resolved === "object" && "i18n" in (resolved as object)) {
      const key = (resolved as { i18n?: { key?: string } }).i18n?.key;
      if (key && k.displayText) {
        const t = k.displayText.lookup(locale, key);
        if (t) return t;
      }
    }
    return typeof resolved === "string" ? resolved : String(resolved ?? "");
  }

  function characterVisual(id: string): string {
    const def = k.catalog.character(id);
    const visual = def?.card?.identity?.visual;
    return typeof visual === "string" ? visual.trim() : "";
  }

  function activeJobForItem(itemId: string): StoredJobRecord | undefined {
    const jobs = store.snapshot().jobs;
    for (let i = jobs.length - 1; i >= 0; i--) {
      const j = jobs[i]!;
      if (j.item === itemId && ACTIVE_JOB_STATES.has(j.state)) return j;
    }
    return undefined;
  }

  async function presetImageRecord(entryId: string, entry: GalleryPresetEntry): Promise<StoredImageRecord | undefined> {
    const snap = store.snapshot();
    if (snap.presetImages[entryId]) return snap.presetImages[entryId];
    if (!entry.image?.src) return undefined;
    if (!isSafeAuthoredRelativePath(entry.image.src)) return undefined;
    const bytes = await k.storage.readBytes(entry.image.src);
    if (!bytes?.length) return undefined;
    const info = sniffImageDimensions(bytes);
    if (!info) return undefined;
    return {
      id: imageIdFromBytes(bytes),
      path: entry.image.src,
      mime: info.mime,
      width: info.width,
      height: info.height,
      bytes: bytes.length,
      createdAt: wallNow(),
    };
  }

  async function buildItemView(
    id: string,
    kind: "preset" | "captured",
    locale: string,
    opts: GalleryListOptions,
  ): Promise<GalleryItemView | undefined> {
    const cfg = config();
    if (!cfg) return undefined;
    const snap = store.snapshot();
    const unlocked = kind === "captured" || Boolean(snap.unlocks[id]);
    const unlockRec = snap.unlocks[id];

    if (kind === "preset") {
      const entry = cfg.entries[id];
      if (!entry) return undefined;
      const rating = entry.rating || cfg.defaultRating;
      const available = ratingAvailable(rating);
      if (!available && !opts.includeUnavailable) return undefined;
      if (!unlocked && opts.includeLocked === false) return undefined;

      let title = "";
      let caption: string | undefined;
      let hint: string | undefined;
      if (unlocked) {
        title = resolveDisplay(entry.title, locale);
        if (entry.caption) caption = resolveDisplay(entry.caption, locale);
      } else {
        if (entry.hint) hint = resolveDisplay(entry.hint, locale);
        if (entry.showTitleWhenLocked) title = resolveDisplay(entry.title, locale);
        else if (entry.lockedTitle) title = resolveDisplay(entry.lockedTitle, locale);
      }

      let image: StoredImageRecord | undefined;
      if (unlocked && available) {
        image = snap.presetImages[id] ?? (await presetImageRecord(id, entry));
      }

      const job = activeJobForItem(id);
      const view: GalleryItemView = {
        id,
        kind: "preset",
        title,
        caption: unlocked ? caption : undefined,
        hint: unlocked ? undefined : hint,
        group: entry.group,
        order: entry.order,
        rating,
        available,
        unlocked,
        unlockedAt: unlockRec,
        characters: [...entry.characters],
        location: entry.location,
        tags: [...entry.tags],
        image: image && unlocked ? toImageRef(image) : undefined,
        job: job ? jobView(job) : undefined,
      };
      if (opts.debug && unlocked && available) {
        const render = entry.render;
        if (render) {
          const { prompt, negative } = composeGalleryPrompts({
            galleryStyle: cfg.style,
            galleryNegative: cfg.negative,
            ratingStyle: cfg.ratings[rating]?.style ?? "",
            ratingNegative: cfg.ratings[rating]?.negative ?? "",
            characterVisuals: entry.characters.map((c) => characterVisual(c)).filter(Boolean),
            renderPrompt: render.prompt,
            renderNegative: render.negative,
          });
          view.debug = { prompt, negative, seed: render.seed };
        }
      }
      return view;
    }

    const cap = snap.captured.find((c) => c.id === id);
    if (!cap) return undefined;
    const available = ratingAvailable(cap.rating);
    if (!available && !opts.includeUnavailable) return undefined;
    const job = activeJobForItem(id);
    const view: GalleryItemView = {
      id: cap.id,
      kind: "captured",
      title: cap.title,
      caption: cap.caption,
      group: "captured",
      order: 0,
      rating: cap.rating,
      available,
      unlocked: true,
      characters: [...cap.characters],
      location: cap.location,
      tags: [...cap.tags],
      lang: cap.lang,
      pinned: cap.pinned,
      image: available && cap.image ? toImageRef(cap.image) : undefined,
      job: job ? jobView(job) : undefined,
    };
    if (opts.debug && available && cap.brief) view.debug = { brief: cap.brief };
    return view;
  }

  function toImageRef(rec: StoredImageRecord): GalleryItemView["image"] {
    return {
      id: rec.id,
      path: rec.path,
      mime: rec.mime,
      width: rec.width,
      height: rec.height,
      bytes: rec.bytes,
      generator: rec.generator,
      seed: rec.seed,
      createdAt: rec.createdAt,
    };
  }

  async function evaluateUnlocks(
    turnKinds: string[] = [],
    event?: Partial<Appraisal> & { type?: string; text?: string },
  ): Promise<void> {
    const cfg = config();
    if (!cfg || !galleryEnabled()) return;
    if (!hasLockedRulePresets()) return;
    const snap = store.snapshot();
    for (const [id, entry] of Object.entries(cfg.entries)) {
      if (snap.unlocks[id]) continue;
      if (!entry.unlock?.when) continue;
      const ctx = galleryCelContext(k, imagePort, unlockedIds(), turnKinds, {
        event: event ? { type: event.type, text: event.text, tags: event.tags, intensity: event.intensity, sincerity: event.sincerity } : undefined,
        sceneId: k.timeline.state().scene?.id,
      });
      let ok = false;
      try {
        ok = k.rules.cel.bool(entry.unlock.when, ctx);
      } catch (e) {
        if (!unlockCelLogged.has(id)) {
          unlockCelLogged.add(id);
          k.warn("GALLERY_UNLOCK_CEL", `gallery entry ${id} unlock CEL failed: ${e instanceof Error ? e.message : String(e)}`, { entry: id });
        }
        ok = false;
      }
      if (ok) await unlockInternal(id, { source: "rule" }, turnKinds);
    }
  }

  async function unlockInternal(id: string, why: { source?: string }, _turnKinds: string[] = []): Promise<GalleryItemView> {
    const cfg = config();
    if (!cfg) throw new AnimaeError("GALLERY_UNKNOWN_ENTRY", `Unknown gallery entry "${id}"`);
    if (!cfg.entries[id]) {
      const cap = store.snapshot().captured.find((c) => c.id === id);
      if (cap) return (await buildItemView(id, "captured", k.i18n.locale, {}))!;
      throw new AnimaeError("GALLERY_UNKNOWN_ENTRY", `Unknown gallery entry "${id}"`);
    }
    const snap = store.snapshot();
    if (snap.unlocks[id]) {
      return (await buildItemView(id, "preset", k.i18n.locale, {}))!;
    }
    const t = k.timeline.now();
    const branch = k.timeline.branch().name;
    const at = wallNow();
    await store.mutate((d) => {
      d.unlocks[id] = { day: t.day, minute: t.minute, branch, at };
    });
    await k.emit([{ kind: "gallery.unlocked", item: id, source: why.source ?? "api" }]);
    notify({ type: "unlocked", item: id });
    const entry = cfg.entries[id]!;
    if (entry.render?.auto && imagePort && !entry.image?.src && !store.snapshot().presetImages[id]) {
      await enqueueRender(id, { seed: entry.render.seed });
    }
    return (await buildItemView(id, "preset", k.i18n.locale, {}))!;
  }

  function pendingCount(): number {
    return store.snapshot().jobs.filter((j) => ACTIVE_JOB_STATES.has(j.state)).length;
  }

  function newJobId(): string {
    jobSeq += 1;
    return `job_${jobSeq.toString().padStart(4, "0")}`;
  }

  async function enqueueRender(itemId: string, o?: { seed?: number; reroll?: boolean }): Promise<string> {
    if (!imagePort) throw new AnimaeError("GALLERY_NO_GENERATOR", "No ImagePort configured");
    if (shuttingDown) throw new AnimaeError("GALLERY_BUSY", "Gallery is shutting down");
    if (pendingCount() >= MAX_PENDING) throw new AnimaeError("GALLERY_BUSY", "Gallery job queue is full");
    const jobId = newJobId();
    const rec: StoredJobRecord = { id: jobId, item: itemId, state: "queued", startedAt: wallNow(), progress: 0 };
    await store.mutate((d) => {
      d.jobs.push(rec);
    });
    notify({ type: "job", job: jobView(rec) });
    if (o) jobRenderOpts.set(jobId, o);
    jobQueue.push(jobId);
    void drainJobQueue();
    return jobId;
  }

  async function drainJobQueue(): Promise<void> {
    if (queueRunning || shuttingDown) return;
    queueRunning = true;
    try {
      while (jobQueue.length > 0 && !shuttingDown) {
        const id = jobQueue.shift()!;
        const o = jobRenderOpts.get(id);
        jobRenderOpts.delete(id);
        await runJob(id, o);
      }
    } finally {
      queueRunning = false;
      if (jobQueue.length > 0) void drainJobQueue();
    }
  }

  async function updateJob(jobId: string, patch: Partial<StoredJobRecord>): Promise<void> {
    await store.mutate((d) => {
      const j = d.jobs.find((x) => x.id === jobId);
      if (!j) return;
      Object.assign(j, patch);
    });
    const j = store.snapshot().jobs.find((x) => x.id === jobId);
    if (j) notify({ type: "job", job: jobView(j) });
  }

  async function runJob(jobId: string, o?: { seed?: number; reroll?: boolean }): Promise<void> {
    const cfg = config();
    if (!cfg || !imagePort) return;
    const abort = new AbortController();
    const promise = (async () => {
      try {
        const pre = store.snapshot().jobs.find((x) => x.id === jobId);
        if (pre?.state === "cancelled") return;
        await updateJob(jobId, { state: "briefing", progress: 0.05 });
        const itemId = store.snapshot().jobs.find((j) => j.id === jobId)?.item;
        if (!itemId) return;

        const snap = store.snapshot();
        let brief: Record<string, unknown> | undefined;
        let rating = cfg.defaultRating;
        let renderPrompt = "";
        let renderNegative = "";
        let seed = o?.seed;
        let characters: string[] = [];
        let capturedEntry: StoredCapturedEntry | undefined;

        const preset = cfg.entries[itemId];
        if (preset) {
          if (!snap.unlocks[itemId]) throw new AnimaeError("GALLERY_LOCKED", `Gallery entry "${itemId}" is locked`);
          rating = preset.rating || cfg.defaultRating;
          if (!ratingAvailable(rating)) throw new AnimaeError("GALLERY_RATING_UNAVAILABLE", `Rating "${rating}" is not available`);
          if (preset.render) {
            renderPrompt = preset.render.prompt;
            renderNegative = preset.render.negative;
            if (seed === undefined) seed = preset.render.seed;
          }
          characters = [...preset.characters];
        } else {
          capturedEntry = snap.captured.find((c) => c.id === itemId);
          if (!capturedEntry) throw new AnimaeError("GALLERY_UNKNOWN_ENTRY", `Unknown gallery entry "${itemId}"`);
          rating = capturedEntry.rating;
          if (!ratingAvailable(rating)) throw new AnimaeError("GALLERY_RATING_UNAVAILABLE", `Rating "${rating}" is not available`);
          brief = capturedEntry.brief;
          characters = [...capturedEntry.characters];
          if (brief && typeof brief === "object" && "prompt" in brief) {
            renderPrompt = String((brief as { prompt?: string }).prompt ?? "");
            renderNegative = String((brief as { negative?: string }).negative ?? "");
          }
        }

        if (!brief && !preset?.render?.prompt && !renderPrompt) {
          brief = await callBrief(itemId, capturedEntry, rating, abort.signal);
          const mid = store.snapshot().jobs.find((x) => x.id === jobId);
          if (mid?.state === "cancelled" || abort.signal.aborted) return;
          if (capturedEntry) {
            await store.mutate((d) => {
              const c = d.captured.find((x) => x.id === itemId);
              if (!c) return;
              c.brief = brief;
              const b = brief as { title?: string; caption?: string };
              if (typeof b.title === "string" && b.title.trim()) c.title = b.title;
              if (typeof b.caption === "string" && b.caption.trim()) c.caption = b.caption;
            });
          }
          renderPrompt = String((brief as { prompt?: string }).prompt ?? "");
          renderNegative = String((brief as { negative?: string }).negative ?? "");
        }

        await updateJob(jobId, { state: "rendering", progress: 0.35 });
        const visuals = characters.map((c) => characterVisual(c)).filter(Boolean).slice(0, cfg.maxCharacters);
        const ratingDef = cfg.ratings[rating];
        const { prompt, negative } = composeGalleryPrompts({
          galleryStyle: cfg.style,
          galleryNegative: cfg.negative,
          ratingStyle: ratingDef?.style ?? "",
          ratingNegative: ratingDef?.negative ?? "",
          characterVisuals: visuals,
          renderPrompt,
          renderNegative,
        });

        const req: ImageRequest = {
          label: "cg",
          prompt,
          negativePrompt: negative || undefined,
          width: cfg.size.width,
          height: cfg.size.height,
          seed,
          rating,
          options: { ...cfg.generator.options },
        };

        const result = await imagePort.generate(req, {
          signal: abort.signal,
          onProgress: (f) => {
            if (f >= 1 || f === 0) void updateJob(jobId, { progress: 0.35 + f * 0.5 });
          },
        });

        const validated = validateGeneratedImageBytes(result.bytes, result.mime);

        await updateJob(jobId, { state: "storing", progress: 0.9 });
        const id = imageIdFromBytes(result.bytes);
        const path = imageStoragePath(id, validated.mime);
        await k.storage.writeAtomic(path, result.bytes);
        const rec: StoredImageRecord = {
          id,
          path,
          mime: validated.mime,
          width: validated.width,
          height: validated.height,
          bytes: result.bytes.length,
          generator: imagePort.id,
          seed: result.seed ?? seed,
          createdAt: wallNow(),
          meta: result.meta,
        };

        await store.mutate((d) => {
          if (preset) d.presetImages[itemId] = rec;
          else {
            const c = d.captured.find((x) => x.id === itemId);
            if (c) c.image = rec;
          }
          const j = d.jobs.find((x) => x.id === jobId);
          if (j) {
            j.state = "done";
            j.progress = 1;
            j.finishedAt = wallNow();
          }
        });

        await k.emit([{ kind: "gallery.rendered", item: itemId, imageId: id, job: jobId }]);
        notify({ type: "changed", item: itemId });
        const j = store.snapshot().jobs.find((x) => x.id === jobId);
        if (j) notify({ type: "job", job: jobView(j) });
      } catch (e) {
        const aborted =
          abort.signal.aborted ||
          (e instanceof DOMException && e.name === "AbortError") ||
          (e && typeof e === "object" && "name" in e && (e as { name: string }).name === "AbortError");
        if (aborted) {
          await updateJob(jobId, { state: "cancelled", finishedAt: wallNow() });
        } else {
          const code = e instanceof AnimaeError ? e.code : "GALLERY_GENERATION_FAILED";
          const message = e instanceof Error ? e.message : String(e);
          await updateJob(jobId, {
            state: "failed",
            error: { code, message },
            finishedAt: wallNow(),
          });
        }
      } finally {
        liveJobs.delete(jobId);
      }
    })();
    liveJobs.set(jobId, { abort, promise });
    await promise;
  }

  async function callBrief(
    itemId: string,
    captured: StoredCapturedEntry | undefined,
    rating: string,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const cfg = config()!;
    const tier = captured?.briefTier ?? cfg.brief.tier;
    const model = tier === "s2" ? k.models.s2 : k.models.s1;
    const ctx = captured?.context;
    const loc = ctx?.locationText ?? (ctx?.location ? k.catalog.location(ctx.location)?.name ?? ctx.location : "");
    const sceneFacts = [`Location: ${loc}`, ctx?.sceneId ? `Scene: ${ctx.sceneId}` : "No active scene"].join("\n");
    const charIds = ctx?.characters?.length ? ctx.characters : captured?.characters ?? [];
    const names = charIds.map((id) =>
      entityDisplayName(k.timeline.state(), k.catalog, id, { viewer: k.authored.world.player }),
    );
    const characterBlock = names.map((n, i) => `- ${n}: ${characterVisual(charIds[i] ?? "")}`).join("\n");
    const focus =
      ctx?.focus ??
      (captured?.brief && typeof captured.brief === "object" && "focus" in captured.brief
        ? String((captured.brief as { focus?: string }).focus)
        : undefined);
    const user = buildCgBriefPrompt({
      promptLocale: k.i18n.promptLocale,
      outputLocale: k.i18n.outputLocale,
      promptLanguage: cfg.promptLanguage,
      sceneFacts,
      characterBlock,
      ratingBrief: cfg.ratings[rating]?.brief ?? "",
      gameGuidance: cfg.brief.guidance,
      maxCharacters: cfg.maxCharacters,
      focus,
    });

    const attempt = async (): Promise<Record<string, unknown>> => {
      const out = await model.object({
        label: "cg_brief",
        segments: { static: user, semiStatic: "", dynamic: "", user: "Produce the JSON brief." },
        maxOutputTokens: 800,
        schema: CgBriefOutputSchema,
      });
      return out as Record<string, unknown>;
    };

    try {
      return await attempt();
    } catch {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      try {
        return await attempt();
      } catch (e) {
        throw new AnimaeError("GALLERY_BRIEF_INVALID", "CG brief model output invalid", e);
      }
    }
  }

  async function pruneCaptured(): Promise<void> {
    const cfg = config();
    if (!cfg || cfg.maxCaptured === 0) return;
    const removedIds: { id: string; image?: StoredImageRecord }[] = [];
    await store.mutate(async (d) => {
      while (d.captured.filter((c) => !c.pinned).length > cfg.maxCaptured) {
        const oldest = d.captured.find((c) => !c.pinned);
        if (!oldest) break;
        d.captured = d.captured.filter((c) => c.id !== oldest.id);
        removedIds.push({ id: oldest.id, image: oldest.image });
      }
      for (const r of removedIds) {
        if (r.image) await removeImageFileIfUnreferenced(d, r.image.id, r.image.path);
      }
    });
    for (const r of removedIds) {
      await k.emit([{ kind: "gallery.removed", item: r.id }]);
      notify({ type: "changed", item: r.id });
    }
  }

  const service: GalleryService = {
    generatorAvailable: () => imagePort !== undefined,
    ratings: () => {
      const cfg = config();
      if (!cfg) return [];
      return Object.entries(cfg.ratings).map(([id, def]) => ({
        id,
        label: resolveDisplay(def.label, k.i18n.locale),
        available: ratingAvailable(id),
      }));
    },
    list: async (opts) => {
      const cfg = config();
      if (!cfg) return [];
      const locale = opts?.locale ?? k.i18n.locale;
      await k.displayText?.prepare([locale]);
      const listOpts = { includeLocked: true, includeUnavailable: false, ...opts };
      const out: GalleryItemView[] = [];
      for (const id of Object.keys(cfg.entries)) {
        const v = await buildItemView(id, "preset", locale, listOpts);
        if (v) out.push(v);
      }
      for (const c of store.snapshot().captured) {
        const v = await buildItemView(c.id, "captured", locale, listOpts);
        if (v) out.push(v);
      }
      out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      return out;
    },
    get: async (id, opts) => {
      const cfg = config();
      if (!cfg) return undefined;
      const locale = opts?.locale ?? k.i18n.locale;
      await k.displayText?.prepare([locale]);
      if (cfg.entries[id]) return buildItemView(id, "preset", locale, { includeLocked: true, ...opts });
      if (store.snapshot().captured.some((c) => c.id === id)) return buildItemView(id, "captured", locale, { includeLocked: true, ...opts });
      return undefined;
    },
    unlock: (id, why) => unlockInternal(id, why ?? {}),
    capture: async (req) => {
      if (!imagePort) throw new AnimaeError("GALLERY_NO_GENERATOR", "No ImagePort configured");
      const cfg = config();
      if (!cfg) throw new AnimaeError("GALLERY_UNKNOWN_ENTRY", "Gallery not configured");
      const rating = req?.rating ?? cfg.defaultRating;
      if (!ratingAvailable(rating)) throw new AnimaeError("GALLERY_RATING_UNAVAILABLE", `Rating "${rating}" is not available`);
      if (pendingCount() >= MAX_PENDING) throw new AnimaeError("GALLERY_BUSY", "Gallery job queue is full");
      const focus = sanitizeGalleryFocus(req?.focus);
      const id = `cap-${randomBytes(4).toString("hex")}`;
      const ctx = snapshotCaptureContext(focus, req?.characters);
      const entry: StoredCapturedEntry = {
        id,
        title: req?.title ?? "",
        rating,
        characters: ctx.characters,
        tags: [],
        lang: k.i18n.outputLocale,
        createdAt: wallNow(),
        briefTier: req?.tier,
        context: ctx,
        brief: focus ? { focus } : undefined,
      };
      await store.mutate((d) => {
        d.captured.push(entry);
      });
      await k.emit([{ kind: "gallery.captured", item: id, rating }]);
      notify({ type: "changed", item: id });
      const job = await enqueueRender(id, { seed: req?.seed });
      await pruneCaptured();
      return { item: id, job };
    },
    render: async (id, opts) => {
      const cfg = config();
      if (!cfg) throw new AnimaeError("GALLERY_UNKNOWN_ENTRY", "Gallery not configured");
      const snap = store.snapshot();
      const isPreset = Boolean(cfg.entries[id]);
      if (isPreset && !snap.unlocks[id]) throw new AnimaeError("GALLERY_LOCKED", `Gallery entry "${id}" is locked`);
      if (!isPreset && !snap.captured.some((c) => c.id === id)) throw new AnimaeError("GALLERY_UNKNOWN_ENTRY", `Unknown gallery entry "${id}"`);
      const job = await enqueueRender(id, { seed: opts?.seed, reroll: opts?.reroll });
      return { job };
    },
    cancel: async (jobId) => {
      const live = liveJobs.get(jobId);
      if (live) {
        live.abort.abort();
        await live.promise.catch(() => undefined);
        return true;
      }
      const qIdx = jobQueue.indexOf(jobId);
      if (qIdx >= 0) {
        jobQueue.splice(qIdx, 1);
        jobRenderOpts.delete(jobId);
        await updateJob(jobId, { state: "cancelled", finishedAt: wallNow() });
        return true;
      }
      const j = store.snapshot().jobs.find((x) => x.id === jobId);
      if (j && ACTIVE_JOB_STATES.has(j.state)) {
        await updateJob(jobId, { state: "cancelled", finishedAt: wallNow() });
        return true;
      }
      return false;
    },
    remove: async (id) => {
      const cfg = config();
      if (cfg?.entries[id]) {
        await store.mutate(async (d) => {
          const img = d.presetImages[id];
          delete d.presetImages[id];
          if (img) await removeImageFileIfUnreferenced(d, img.id, img.path);
        });
        notify({ type: "changed", item: id });
        return;
      }
      await store.mutate(async (d) => {
        const idx = d.captured.findIndex((c) => c.id === id);
        if (idx < 0) throw new AnimaeError("GALLERY_UNKNOWN_ENTRY", `Unknown gallery entry "${id}"`);
        const [removed] = d.captured.splice(idx, 1);
        if (removed?.image) await removeImageFileIfUnreferenced(d, removed.image.id, removed.image.path);
      });
      await k.emit([{ kind: "gallery.removed", item: id }]);
      notify({ type: "changed", item: id });
    },
    pin: async (id, pinned) => {
      await store.mutate((d) => {
        const c = d.captured.find((x) => x.id === id);
        if (!c) throw new AnimaeError("GALLERY_UNKNOWN_ENTRY", `Unknown captured entry "${id}"`);
        c.pinned = pinned;
      });
      notify({ type: "changed", item: id });
    },
    image: async (id) => {
      const cfg = config();
      if (!cfg) return undefined;
      const snap = store.snapshot();
      const preset = cfg.entries[id];
      if (preset) {
        if (!snap.unlocks[id]) return undefined;
        if (!ratingAvailable(preset.rating || cfg.defaultRating)) return undefined;
        const rec = snap.presetImages[id] ?? (await presetImageRecord(id, preset));
        if (!rec) return undefined;
        const bytes = await k.storage.readBytes(rec.path);
        if (!bytes) return undefined;
        return { bytes, ref: toImageRef(rec)! };
      }
      const cap = snap.captured.find((c) => c.id === id);
      if (!cap?.image) return undefined;
      if (!ratingAvailable(cap.rating)) return undefined;
      const bytes = await k.storage.readBytes(cap.image.path);
      if (!bytes) return undefined;
      return { bytes, ref: toImageRef(cap.image)! };
    },
    jobs: () =>
      store
        .snapshot()
        .jobs.filter((j) => itemVisibleToSubscriber(j.item))
        .map(jobView),
    subscribe: (handler) => {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },
  };

  const hooks: GalleryLifecycleHooks = {
    afterTurn: async (turnKinds, event) => {
      await evaluateUnlocks(turnKinds, event);
    },
    afterSceneEnd: async () => {
      await evaluateUnlocks([]);
    },
    afterWorldChange: async () => {
      await evaluateUnlocks([]);
    },
    close: async () => {
      shuttingDown = true;
      jobQueue.length = 0;
      jobRenderOpts.clear();
      for (const [, live] of liveJobs) live.abort.abort();
      await Promise.all([...liveJobs.values()].map((l) => l.promise.catch(() => undefined)));
      await store.mutate((d) => {
        for (const j of d.jobs) {
          if (ACTIVE_JOB_STATES.has(j.state)) {
            j.state = "cancelled";
            j.finishedAt = wallNow();
          }
        }
      });
    },
  };

  return Object.assign(service, hooks);
}
