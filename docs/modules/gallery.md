# Module: `gallery`

## Purpose

Profile-scoped CG collection: authored preset entries (CEL unlock, optional shipped art, optional auto-render) and runtime captured entries (scene snapshot, model brief, `ImagePort` render). Ratings gate list, brief, generate, and serve. See [gallery.md](../gallery.md).

## Public API

- `createGalleryService(kernel, imagePort?, opts?): GalleryService & GalleryLifecycleHooks` — internal factory; hosts use `Engine.gallery` (`GalleryService`).
- `composeGalleryPrompts`, `sniffImageDimensions`, `imageMimeFromBytes`, `validateGeneratedImageBytes` (via `util.ts` exports as needed).
- Types: `GalleryService`, `GalleryItemView`, `GalleryNotice`, `GalleryJobView`, `ImagePort` (`ports.ts`).
- Schema: `GalleryConfigSchema`, `GalleryPresetEntrySchema` (`schema/gallery.ts`).
- Authored validation: `validateGalleryAuthored` (`authored/gallery-validate.ts`) from `animae validate`.

## Data flow

1. **Load** — `GalleryCollectionStore.load()` reads `gallery/collection.json` (or rebuilds after corrupt file move-aside).
2. **Unlock** — After turn / scene end / `world.set`, `evaluateUnlocks` runs CEL on locked presets with `gallery.unlocked`, `turn.kinds`, `image.tags`.
3. **Capture** — `capture()` writes capture row + snapshot, emits `gallery.captured`, enqueues job.
4. **Job** — FIFO queue (max 8 active): brief → compose → `ImagePort.generate` → atomic store → `gallery.rendered` + notices.
5. **Serve** — `image()` / RPC enforce unlock + rating availability; bytes read through `StoragePort`.

```
  authored gallery config
           |
           v
  GalleryService <-----> GalleryCollectionStore ---- StoragePort
           |                      ^
           +-- ModelPort (cg_brief)
           +-- ImagePort (generate)
           +-- timeline.emit (events)
```

## Invariants

- All collection mutations go through `GalleryCollectionStore.mutate` (single serialized writer).
- Image ids are content hashes (16 hex); paths only under `gallery/images/`.
- Preset unlock in collection is append-only (idempotent unlock API and CEL).
- Timeline reducer does not mutate gallery state on replay.
- Unavailable ratings: no image bytes, filtered jobs/notices, optional `includeUnavailable` on list/get.

## Decisions

- Collection authority vs timeline events (events are provenance only).
- Job queue concurrency 1; progress persisted on job records for UI.
- Corrupt index: preserve bytes, move bad JSON to `collection.json.corrupt-*`, rebuild capture rows from image files (preset unlocks lost).
- Prune: oldest unpinned captures when over `maxCaptured`; `gallery.removed` + image ref-counting.
- `Engine.gallery` public type is `GalleryService`; lifecycle hooks on kernel module slot for pipeline integration.

## Edge cases

- Unlock while rating unavailable: entry unlocks in collection but stays hidden until rating CEL is true.
- `render.auto` on unlock when no shipped art and port present.
- Restart: stale active jobs → `failed` / `interrupted`; brief retained on capture for retry.
- `engine.close()` during queue drain: shutdown flag prevents new jobs; abort in-flight port calls.
- Orphan image cleanup after 24h grace when not referenced by index.
- Forward-compatible collection `version > 1`: read known fields without deleting extra JSON (future writers).

## Test map

| Area | File |
|------|------|
| Service, unlock, capture, cancel, replay | `test/gallery/gallery.test.ts` |
| Hardening, stress, RPC, corrupt index, orphans | `test/gallery/gallery-hardening.test.ts` |
| Compose + sniff fixtures | `test/gallery/compose-sniff.test.ts` |
| Fake port behaviors | `test/gallery/fake-image-port.ts` |
| Authored fixture | `test/gallery/fixture.ts` |
