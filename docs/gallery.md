# CG gallery and image generation

The CG gallery is a **profile-scoped illustration collection** inside the Animae engine. Games author **preset slots** (stable ids, optional shipped art, CEL unlock rules) and may offer **captured moments** (runtime entries generated from the live scene). All image bytes come from a host-implemented **`ImagePort`**; the engine never calls a concrete generator.

Module implementation notes: [modules/gallery.md](./modules/gallery.md). Host wiring (commands, WebSocket, HTTP): [Hosts and clients](#hosts-and-clients) below.

## Mental model

1. **Authored config** (`animae.yaml` → `gallery`) defines ratings, preset entries, prompt defaults, and validation rules.
2. **Collection state** (`gallery/collection.json` + `gallery/images/*`) holds unlock timestamps, generated art, captured entries, and persisted job records. It is shared across all timelines of a profile (rewinds do not re-lock presets).
3. **Timeline events** (`gallery.unlocked`, `gallery.captured`, `gallery.rendered`, `gallery.removed`) record provenance for export and debugging. The reducer does not derive gameplay state from them; the collection file is authoritative.
4. **Jobs** run off the hot path: brief (optional) → compose prompts → `ImagePort.generate` → store bytes → notify subscribers.

```
  animae.yaml (gallery)          collection.json + images/
         |                                ^
         v                                |
  GalleryService  ---- jobs queue ----> StoragePort
         |                                |
         +-------- timeline events -------+
```

## Quick start

Minimal preset with shipped art (no generator required to view):

```yaml
gallery:
  entries:
    harbor-sunset:
      title: Harbor at sunset
      hint: Visit the docks together.
      rating: general
      characters: [player, guide]
      image:
        src: gallery/art/harbor.webp
      unlock:
        when: "event.type == 'arrival'"
```

Headless capture with a stub port (tests use the same pattern):

```typescript
import { createEngine, createScriptedModel } from "@animae/engine";
import { createFakeImagePort } from "@animae/engine/test/gallery/fake-image-port";

const image = createFakeImagePort("stub/local", { kind: "instant" }, ["tier:general"]);
const engine = await createEngine({
  root: dataRoot,
  ports: { image },
  models: { s1: scriptedS1, s2: scriptedS2 },
});
await engine.scene.start({ location: "tavern", participants: ["player", "guide"] });
const { item, job } = await engine.gallery.capture({ focus: "quiet table" });
```

Wire `ImagePort` in production hosts via `createEngine({ ports: { image } })`. See [embedding.md](./embedding.md).

## Concepts

| Term | Meaning |
|------|---------|
| **Preset entry** | Authored id under `gallery.entries`. May ship read-only art (`image.src`) and/or `render.prompt` for generation. |
| **Captured entry** | Runtime id `cap-<8 hex>`. Created by `capture()`; stores a scene snapshot, optional brief, and generated image. |
| **Collection** | Persistent registry: unlocks, preset generated images, captured list, job history. |
| **Rating** | Authored id with CEL `when`. Controls visibility, brief/generate permission, and image serving. |
| **Job** | One render pipeline: `queued → briefing → rendering → storing → done \| failed \| cancelled`. |
| **Brief** | Model call (`label: "cg_brief"`) producing `{ title, caption, prompt, negative?, characters[] }` for captures (and presets without `render.prompt`). |

### Locked preset masking

While locked, presets expose **`hint`** and hide caption, art, and render prompts. **`title`** is empty unless `showTitleWhenLocked: true` (shows authored title) or `lockedTitle` is set. Unavailable ratings are omitted from default `list()` / `get()` unless `includeUnavailable: true`; unlock may still occur (see [Ratings and privacy](#ratings-and-privacy)).

## Authoring reference (`animae.yaml`)

Top-level key `gallery` (optional). Mods may patch it like any other config block.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | true when entries exist or an `ImagePort` is wired | Master switch. |
| `defaultRating` | `general` | Used when an entry omits `rating`. |
| `promptLanguage` | `en` | Language for generator-oriented brief `prompt` field. |
| `style` | `""` | Prefix merged into every image prompt. |
| `negative` | `""` | Base negative prompt. |
| `size.width` / `size.height` | `768` / `512` | Requested output size (generators may round). |
| `maxCharacters` | `3` | Cap on `identity.visual` tags injected per render. |
| `maxCaptured` | `200` | Max stored captures (`0` = unlimited). Oldest **unpinned** captures are pruned. |
| `brief.tier` | `s1` | Model slot for brief (`s1` or `s2`). |
| `brief.guidance` | `""` | Extra brief instructions (content locale prose). |
| `generator.options` | `{}` | Opaque map passed to `ImagePort.generate` as `options`. |
| `ratings.<id>.label` | — | Display string or `$t:` catalog value. |
| `ratings.<id>.when` | `"true"` | CEL: rating available now. |
| `ratings.<id>.style` / `negative` / `brief` | `""` | Per-rating prompt/brief additions. |
| `entries.<id>.*` | — | Preset entry (see below). |

### Preset entry fields

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Localized string or `$t:` key. |
| `caption` | no | Shown when unlocked. |
| `hint` | when `unlock.when` set | Shown while locked. |
| `showTitleWhenLocked` | default false | Reveal real title while locked. |
| `lockedTitle` | no | Placeholder title while locked. |
| `group` | default `default` | UI section id. |
| `order` | default `0` | Sort key within list. |
| `rating` | default `defaultRating` | Must reference a defined rating id. |
| `characters` | default `[]` | Character ids for filtering and visual injection. |
| `location` | no | Metadata for UI. |
| `tags` | default `[]` | Free-form tags. |
| `unlock.when` | no | CEL evaluated after turns; omit for manual unlock only. |
| `image.src` | no | Shipped art path relative to authored root (no `..`). |
| `render.prompt` | when generating | Generator scene description. |
| `render.negative` | default `""` | Extra negative prompt. |
| `render.seed` | no | Optional fixed seed. |
| `render.auto` | default false | Queue render on first unlock when no shipped art and a port exists. |

Character cards may define `identity.visual` (generator-oriented appearance tags). The engine injects visuals for `entry.characters` in order, capped by `maxCharacters`.

### Authoring examples

**Shipped art, rule unlock**

```yaml
gallery:
  ratings:
    general: { label: General, when: "true" }
  entries:
    first-meeting:
      title: First meeting
      hint: Share a meal together.
      rating: general
      characters: [player, mira]
      unlock:
        when: "event.type == 'share_meal'"
      image:
        src: gallery/art/first-meeting.webp
```

**Auto-render on unlock (no shipped file)**

```yaml
    lantern-night:
      title: Lantern night
      hint: End the day at the market.
      rating: general
      characters: [player, odo]
      unlock:
        when: "turn.kinds.exists(k, k == 'scene_end')"
      render:
        prompt: "night market lanterns, two figures, warm tones"
        auto: true
```

**Manual unlock only**

```yaml
    secret-sketch:
      title: Secret sketch
      hint: Unlocked by story script.
      rating: general
      characters: [player]
      render:
        prompt: "pencil sketch on desk, soft light"
```

**Captured flow** — no entry required; players call `engine.gallery.capture()` when a port is wired.

Validation (`animae validate`): duplicate entry ids, unknown character/location/rating refs, CEL syntax on `unlock.when` / `rating.when`, missing shipped art files, path traversal in `image.src`, `$t:` key resolution, and **`hint` required when `unlock.when` is set**.

## Ratings and privacy

Example rating ids (neutral): `general`, `restricted`.

| Behavior | Unavailable rating |
|----------|-------------------|
| `list()` / `get()` | Hidden unless `includeUnavailable: true` (`available: false` then shown). |
| `capture()` / `render()` | `GALLERY_RATING_UNAVAILABLE`. |
| `image()` | `undefined` (HTTP/RPC → null/404). |
| `jobs()` / `subscribe` notices | Jobs/notices for hidden items are filtered. |

**Unlock vs availability:** `unlock.when` is evaluated independently of whether the entry's rating is currently available. A preset may unlock while still hidden until the rating becomes available (for example when the host adds a capability tag to `image.tags`).

CEL examples:

```yaml
ratings:
  general:
    label: General
    when: "true"
  restricted:
    label: Restricted
    when: "'tier:restricted' in image.tags"
```

## CEL context (gallery hooks)

Unlock rules and `rating.when` use the standard rule context plus:

| Variable | Shape | Meaning |
|----------|-------|---------|
| `gallery.unlocked` | `string[]` | Preset ids already unlocked in the collection. |
| `turn.kinds` | `string[]` | Event kinds committed in the current turn (when evaluating after turn). |
| `image.tags` | `string[]` | `ImagePort.tags` from the wired port (empty when none). |
| `model.tags` | `string[]` | Same as elsewhere in policy CEL. |

Evaluation runs after each committed turn, scene end, and `world.set`. Errors in `unlock.when` are logged **once per entry** and treated as false. When no locked presets define `unlock.when`, evaluation is skipped.

See [cel-reference.md](./cel-reference.md).

## Prompt composition

Deterministic merge (unit-tested in `composeGalleryPrompts`):

```
prompt   = join(", ", dedupe([gallery.style, rating.style, ...visuals(characters), render.prompt]))
negative = join(", ", dedupe([gallery.negative, rating.negative, render.negative]))
```

Dedupe is case-insensitive on comma-separated pieces.

**Worked example**

- `gallery.style`: `masterpiece, scenic`
- `rating.style`: `soft lighting`
- Character visuals: `silver hair`, `green coat`
- `render.prompt`: `two people in a greenhouse at dawn`

→ `prompt`: `masterpiece, scenic, soft lighting, silver hair, green coat, two people in a greenhouse at dawn`

## Brief call (`cg_brief`)

For captures (and presets without `render.prompt`), the engine calls the model router with label **`cg_brief`**, tier `gallery.brief.tier` or per-capture `tier` override.

Prompt sections load from `prompts/<promptLocale>/gallery.json` (role, scene facts, characters + visuals, composition, rating guidance, game guidance, JSON contract). Scene facts use **display names** (alias-aware), not raw ids. Title and caption target the engine **output locale**; image `prompt` targets `gallery.promptLanguage`.

Structured output is validated with zod; **one retry** on invalid JSON, then `GALLERY_BRIEF_INVALID`. Capture `focus` text is trimmed, control characters removed, and length capped before it enters the brief.

Recording/replay: brief calls appear in the model call log like other labeled calls; timeline replay does not re-invoke the image port.

## Jobs and queue

```
  capture()/render()
        |
        v
     queued  ---------------------------+
        |                                |
        v                                | cancel (queued: drop)
    briefing  (model cg_brief)           |
        |                                |
        v                                |
    rendering  (ImagePort + AbortSignal) |
        |                                |
        v                                |
     storing  (hash, write image, index)  |
        |                                |
        v                                |
      done | failed | cancelled <---------+
```

- **FIFO**, concurrency **1**, at most **8** active jobs (`GALLERY_BUSY` when full).
- **`cancel(job)`**: queued jobs removed; in-flight briefing may finish but result is discarded; rendering aborts via `AbortSignal` → `cancelled`; storing runs to completion.
- **`engine.close()`**: sets shutdown flag, aborts live work, cancels queued jobs, awaits settlement.
- **Restart**: jobs left in `queued|briefing|rendering|storing` without a live worker become `failed` with code `interrupted`. Captured briefs are kept for `render(id)` retry.

## ImagePort

```typescript
interface ImagePort {
  readonly id: string;
  readonly tags?: readonly string[];
  /** When false, the port is wired but cannot generate (disabled backend). Omitted means ready when present. */
  available?(): boolean;
  generate(req: ImageRequest, opts?: { signal?: AbortSignal; onProgress?(n: number): void }): Promise<ImageResult>;
}
```

`ImageRequest` includes composed `prompt`, `negativePrompt`, size, `rating`, and merged `options`. Hosts must honor **`AbortSignal`** (reject with abort reason). Returned bytes are sniffed (PNG/WebP/JPEG header only—no decode libraries); empty, oversize (>12 MiB), or non-image bytes → `GALLERY_GENERATION_FAILED`.

Without a port, shipped preset art and listing still work; `capture()` / `render()` throw `GALLERY_NO_GENERATOR`.

## Engine API (`GalleryService`)

| Method | Summary |
|--------|---------|
| `generatorAvailable()` | Whether an `ImagePort` is wired and `available?.()` is not false. |
| `ratings()` | All authored ratings with `available` flag. |
| `list(opts?)` | Presets + captures; `includeLocked` (default true), `includeUnavailable` (default false), `debug`. |
| `get(id, opts?)` | Single item view. |
| `unlock(id, why?)` | Idempotent preset unlock. |
| `capture(req?)` | New capture + job. |
| `render(id, opts?)` | Enqueue render (preset or capture). |
| `cancel(job)` | Returns whether a job was cancelled. |
| `remove(id)` | Delete capture or preset **generated** art. |
| `pin(id, pinned)` | Pin capture against pruning. |
| `image(id)` | Bytes + ref when unlocked and rating available. |
| `jobs()` | Job views (filtered for unavailable items). |
| `subscribe(handler)` | `GalleryNotice` stream. |

Public type `Engine.gallery` is `GalleryService`; lifecycle hooks (`afterTurn`, `close`, …) are invoked by the engine kernel, not part of the host contract.

## Storage layout

| Path | Content |
|------|---------|
| `gallery/collection.json` | Versioned index: `unlocks`, `presetImages`, `captured[]`, `jobs[]`. |
| `gallery/images/<imageId>.{png,webp,jpg}` | Content-addressed id = first 16 hex of SHA-256 of bytes. |
| `gallery/collection.json.corrupt-<ts>` | Previous file when JSON parse fails; index rebuilt from images (preset unlock flags lost). |

Writes use `StoragePort.writeAtomic` (temp + rename). Images are written before the index references them. Orphan files under `gallery/images/` with no index reference and mtime older than 24h are removed on service startup. Identical bytes share an id; **reference counting** deletes files only when no entry references the image id.

Preset `image.src` paths must stay under the authored root (validated at load and enforced at read time).

## Events

| Kind | Payload | Notes |
|------|---------|-------|
| `gallery.unlocked` | `{ item, source? }` | First unlock only. |
| `gallery.captured` | `{ item, rating }` | New capture entry. |
| `gallery.rendered` | `{ item, imageId, job }` | Stored bytes. |
| `gallery.removed` | `{ item }` | Capture removed or pruned. |

Reducer: no gameplay mutation (provenance only).

## Notices (`GalleryNotice`)

| Type | Payload |
|------|---------|
| `unlocked` | `{ item }` |
| `job` | `{ job: GalleryJobView }` |
| `changed` | `{ item }` |

Notices for items whose rating is currently unavailable are suppressed (no leaking hidden ids through the notice stream).

## RPC

| Method | Params | Result |
|--------|--------|--------|
| `gallery.list` | `{ opts? }` | `GalleryItemView[]` |
| `gallery.get` | `{ id, opts? }` | item or null |
| `gallery.ratings` | — | `GalleryRatingView[]` |
| `gallery.unlock` | `{ id, why? }` | item |
| `gallery.capture` | `{ req? }` | `{ item, job }` |
| `gallery.render` | `{ id, opts? }` | `{ job }` |
| `gallery.cancel` | `{ job }` | `boolean` |
| `gallery.remove` | `{ id }` | null |
| `gallery.pin` | `{ id, pinned }` | null |
| `gallery.jobs` | — | `GalleryJobView[]` |
| `gallery.image` | `{ id }` | `{ ref, base64 }` or null (12 MiB cap) |

Server notification: **`gallery.notice`** with the same union as `subscribe`. Details: [rpc-reference.md](./rpc-reference.md).

## Error codes

| Code | Typical cause | Remedy |
|------|---------------|--------|
| `GALLERY_NO_GENERATOR` | No `ImagePort` on `capture`/`render`. | Wire a port or use shipped art only. |
| `GALLERY_UNKNOWN_ENTRY` | Bad id or gallery disabled. | Check id and config. |
| `GALLERY_LOCKED` | Preset render/unlock before unlock. | Play unlock rules or call `unlock`. |
| `GALLERY_RATING_UNAVAILABLE` | Rating CEL false. | Change rating or host tags. |
| `GALLERY_BUSY` | More than 8 active jobs or shutting down. | Wait, cancel jobs, or retry. |
| `GALLERY_BRIEF_INVALID` | Brief model output invalid after retry. | Fix prompts/model; retry render. |
| `GALLERY_GENERATION_FAILED` | Port error, bad bytes, or RPC oversize. | Inspect generator logs; retry. |

Messages on thrown `AnimaeError` values are developer-facing English. **`@animae/host`** maps `GALLERY_*` codes to catalog keys (`error.gallery_*`) via `formatGalleryError` / `galleryErrorMessageKey` (`packages/host/src/gallery-errors.ts`). UI copy must not show bare codes outside parentheses; `galleryErrorTextShowsBareCode` detects leaked tokens (including fullwidth brackets around a code).

## Security and privacy

- Path traversal blocked for `image.src` and gallery image paths (hash-based filenames only under `gallery/images/`).
- MIME type taken from byte sniffing, not file extensions.
- `debug: true` on `list`/`get` exposes prompts/briefs only for **unlocked** items with **available** ratings.
- Restricted ratings depend on host capability tags; switching mods or tiers hides items without deleting bytes.

## Performance

Local generators may take minutes per image; the engine keeps the default queue at **one concurrent job** so turns stay responsive. Progress updates are best-effort via `onProgress`. Prefer async UI with job chips rather than blocking turns.

## Testing

Use **`createFakeImagePort`** (`packages/engine/test/gallery/fake-image-port.ts`) with behaviors `instant`, `delay`, `fail`, `garbage`, `empty`, and `abortable`. Pair with **`createScriptedModel`** returning structured briefs for `label === "cg_brief"`.

```typescript
const model = createScriptedModel("test/s1", (req) =>
  req.label === "cg_brief"
    ? { title: "T", caption: "C", prompt: "scene tags", characters: [{ name: "Mira" }] }
    : { text: "ok" },
);
```

Run `bun test packages/engine/test/gallery`. Hygiene tests ensure engine-neutral wording in docs and code.

## FAQ

**Why did my capture stay after a failed render?** Captures are kept so the UI can offer retry (`render(id)`) or `remove(id)`.

**Does rewind remove unlocks?** No. The collection is profile-scoped.

**Can two entries share one image file?** Yes, when bytes match (same hash id); reference counting prevents premature deletion.

**Does replay regenerate art?** No. Replay does not call `ImagePort` or mutate the collection.

## Hosts and clients

### `@animae/host` (`SessionHost`)

- Typed accessors (viewer locale via `list`/`get` options): `galleryList`, `galleryGet`, `galleryRatings`, `galleryJobs`, `galleryGeneratorAvailable`, `galleryUnlock`, `galleryCapture`, `galleryRender`, `galleryCancel`, `galleryRemove`, `galleryPin`, `galleryImage`.
- `engine.gallery.subscribe` → `StreamCallbacks.onGalleryNotice` (`GalleryNotice`) plus localized toasts/transcript lines when `galleryNotices.toasts !== false`.
- Options: `galleryNotices: { maskTitle?(item), toasts? }` — generic notice titles when `maskTitle` returns true (mature ratings behind blur); `toasts: false` when the client renders its own gallery toasts from WebSocket `gallery_notice`.
- Builtin `:gallery` (`list`, `show`, `capture`, `render`, `cancel`, `remove`, `pin`, `unpin`, `open`, `ratings`, `jobs`, `unlock`); `GALLERY_*` → host i18n (`error.gallery_*`).
- Options: `openFile(path)` for `:gallery open` / TUI `o`; wire OS viewer from the game bootstrap.

### `@animae/web` (additive messages, protocol version 1)

- Client messages: `gallery_list`, `gallery_get`, `gallery_ratings`, `gallery_capture`, `gallery_render`, `gallery_cancel`, `gallery_remove`, `gallery_pin`, `gallery_unlock` (only when `gallery.allowGalleryUnlock`), `gallery_jobs`. Results: `{ type: "result", data: { gallery?, ratings?, jobs?, ... } }`.
- Push: `{ type: "gallery_notice", notice: GalleryNotice }` to **all** clients (including spectators).
- Mutations require controller; list/get/ratings/jobs are read-only for spectators.
- HTTP: `GET|HEAD /api/gallery/image/<entryId>?v=<imageId>` — same auth/origin as `/ws`; bytes from `SessionHost.galleryImage`; `404` when locked/unavailable/wrong `v`; `ETag` = image id; `304` on match.
- `createWebServer({ gallery: { defaultRating?, galleryImagePolicy?(item), allowGalleryUnlock? } })`. Default policy: `immutable` private cache when `item.rating === defaultRating` (default `general`), else `no-store`.

### `@animae/tui`

- `:gallery` (host command) opens overlay `gallery`; panel keys ↑↓, Enter (reveal when `galleryPresentation` masks), `c` capture, `r` render, `x` cancel, `o` open, `p` pin, `d` delete (confirm), Esc close.
- `RunTuiOptions.galleryPresentation?(item) → { blur?: boolean }`, `openFile?(path)`.

### `animae` CLI

- `animae gallery list|show|capture|render|cancel|remove|pin|ratings|jobs [--json]`.
- Global `--image-command` / repeatable `--image-command-arg` → `createCommandImagePort` (JSON `ImageRequest` on stdin, image bytes on stdout); same flags for `animae serve --stdio` when opening the engine with an image port.
