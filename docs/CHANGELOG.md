# Changelog

## Unreleased

### `@animae/engine`

- **Model request timeout:** optional `ModelSpec.timeoutMs` (defaults: 120 s remote, 600 s `ollama`). `generateText` uses the AI SDK `timeout`; streams use an engine-owned idle watchdog (`createStreamWatchdog`: connecting + time-to-first-token, then gaps between chunks, no total cap) because the SDK's `firstChunkMs` never fires while the HTTP request is still pending. Timeouts are retried at most once in both paths.
- **Classified model errors:** `MODEL_TIMEOUT`, `MODEL_UNREACHABLE` (now also Bun's `ConnectionRefused` / `FailedToOpenSocket` / `ConnectionClosed`), `MODEL_HTTP`, `MODEL_EMPTY`; the pipeline preserves codes instead of flattening to `RENDER_FAILED`. On the stream path the real provider error is captured through `onError` (the SDK otherwise rejects with a generic "No output generated" and prints the error to the console), so HTTP 4xx/5xx and refused connections are reported as such and 429/5xx/unreachable are retried. `syncModelPortSpec` for hot config.
- **Character knowledge paths:** `loadCharacterFromFiles` now matches `characters/<id>/knowledge/*.md` using the same relative paths as storage (fixes mod and base character knowledge never loading).
- **Turn prompt extensions:** optional `TurnCtx.promptExtraStatic` / `promptExtraDynamic` merge into render prompts; stage hooks receive the kernel as an optional third argument (`(ctx, next, kernel)`), so existing two-argument hooks keep working.
- **Localized track and tier names for games:** `trackLabel(kernel, trackId)` and `tierLabel(kernel, trackId, tierName)` are exported from the pipeline entry point, so a game's own prompt blocks name a track or tier in the same prompt language as the engine's relation lines (explicit label, then `track.<id>.label` / `tier.<track>.<name>.label` / `tier.<name>.label` string-table conventions, then the prettified id).
- **Model error classification is stricter:** output-shape errors (`NoObjectGeneratedError`, `TypeValidationError`, `JSONParseError`) quote the model's own text, so a reply that merely mentions a "timeout" is no longer classified as `MODEL_TIMEOUT`; a provider failure on a stream stops the idle watchdog so it cannot relabel the failure as a timeout afterwards.
- **Gallery jobs never stall silently:** a queued render whose generator became unavailable before it ran now ends as `failed` with `GALLERY_NO_GENERATOR` instead of staying `queued`.
- **Knowledge `when` failures are non-fatal:** a contextual knowledge condition that throws (for example an unguarded `fields.<id>` read while that field is inactive) no longer aborts the turn; the document is skipped and one `config.warning` (`KNOWLEDGE_WHEN_FAILED`, with the document id and path) is emitted per document and kernel.
- **Slim LLM recordings:** stream rows in `recordings.jsonl` persist `tool` + `final` parts only (no cumulative partials); replay synthesizes one partial before final. Identical `record` appends are skipped; record/live open may compact branch files last-wins (`compactRecordingsFile` for tools). Legacy partial-heavy rows still replay verbatim.
- **`revoke(viewer, path)`:** end a temporary introspection grant before its TTL (`Engine.revoke`, `Introspect.revoke`, RPC `revoke`); writes `visibility.expired`.
- **Scene-scoped dialogue history:** `buildRecentHistory` filters by scene participation before the K-turn window; optional `HistoryScope` for post-`scene.end` callers.
- **L3 field rules:** `rule_add` / `rule_override` consumed in adjudicate, scene_start, scene_end, and daily; strict schema; grant-time validation; `scene_end` stage before `scene.ended`.
- **CG gallery:** optional `ImagePort`, `Engine.gallery` (`GalleryService`), authored ratings and preset/captured entries, CEL unlocks, model brief (`cg_brief`), job queue (cancel, retry), profile-scoped `gallery/collection.json`, events `gallery.*`, RPC `gallery.*` + `gallery.notice`. Gallery display strings resolve with `display.resolve(..., { localizeNames: true })`.
- **Gallery generator probe:** optional `ImagePort.available?()`; `@animae/web` gallery list/jobs responses may include `generatorAvailable`.
- **Name references:** `{{name:<id>}}` in authored text; string-table keys `character.<id>.name|nickname`; prompt glossary uses the **nickname** string when the card defines one, otherwise `name`; `DisplayText.resolve(..., { localizeNames })` for UI in another language than card prose.
- **Locale overlays:** first locale in the content chain that provides a file/patch/append wins for that path (fallback locales do not override).
- **Patch merge:** `$append` / `$prepend` on string values in policy and mod patches.
- **Prompt assembly:** section-aware `render.maxSegmentChars`, `render.recall.*` caps, `render.knowledgeIndexMax`, `x.prompt.*` conventions; `template_partials` are render-only; knowledge `inject` / `when` with `model.tags`.
- **i18n:** strict per-locale string lookup for display; no raw `$t:` keys in assembled prompts.
- **Leaner appraisal prompts:** the stage's constant instructions go to the static (cacheable) segment through `PromptInput.extraStatic`, only per-turn extras stay dynamic; appraise receives no contextual (`when`) knowledge and no template-partial narration guidance.
- **Recall without repeats:** a retrieved knowledge document that the prompt already carries in full (always-injected in static, contextual in dynamic) is no longer recalled again as an excerpt.
- **Reflection prompt:** the static segment spells out all three output fields with the shape of their items (naming `goal_changes` / `new_claims` alone made a real model answer claims as plain strings, so every reflection was rejected by the schema) and states one output language for all text; the dynamic segment lists the character's current goals with their ids so `update` / `remove` can name one.
- **Blank replies:** the render schema rejects a reply without text (the adapter then retries once with the repair hint, and `renderStage` fails with `RENDER_FAILED` instead of committing a blank utterance and memory); `dialogue` / `speech` / `reply` / `response` / `content` / `message` / `line` / `narration` are read as `text` when a model ignores the field name.

### `@animae/i18n`

- **`ResolvableText` / `resolveText`:** user-visible copy that is a fixed string or a function resolved at render time; shared by the terminal UI and headless hosts (`@animae/tui` re-exports it unchanged).

### `@animae/host`

- Gallery accessors, `:gallery`, localized `GALLERY_*` errors (`gallery-errors.ts`), optional `galleryNotices` (`maskTitle`, `toasts`).
- **Localizable action copy:** `HostAction` / `HostEntityAction` labels, hints, and argument labels accept `ResolvableText` (`string | () => string`); `SessionHost.listActions()` resolves them in the viewer's UI locale, so clients with different languages receive their own toolbar and palette text in one session. The host no longer depends on the terminal UI at run time.
- Optional `HostCommandApi.focusTarget()`: the member the client has focused, for commands that can infer their argument from it.

### `@animae/web`

- Gallery client messages, `gallery_notice` push, image HTTP route; optional host hook **`images_probe`** for generator health checks with unsaved settings draft.
- **Diagnostics page (`/ref/`):** rebuilt as a styled, responsive console: tabs for smoke tests, model call log (`llm_log` / `llm_log_clear`), snapshot/state, live protocol feed (JSON tree) and a controller-only console; en and zh-CN catalogs for every string (parity-tested), light/dark theme. The read-only smoke runner has an injectable transport and checks socket, hello, snapshot shape, ping RTT, locale, secret masking, model log, state and resume. Overview includes an **Environment** card when the host implements `WebSessionHooks.environment` (`GET /api/environment`, same auth as other `/api/*` routes).
- **`WebSessionHooks.environment`:** optional hook returning localized path/version rows for the diagnostics page and authenticated HTTP clients.
- **Replay on connect:** a client that has seen nothing (`hello.resumeSeq` 0 or absent) no longer receives the buffered stream of every earlier turn, only the turn that is still running; a returning client (`resumeSeq > 0`) still gets everything after its last message. The old behaviour replayed up to 500 stale `stream` / `busy` messages to every fresh page.

### Documentation

- English [spec.md](./spec.md) is canonical; [spec.zh-CN.md](./spec.zh-CN.md) is the Chinese edition.
- Removed legacy section-reference marks from engine markdown; cross-doc links use relative paths and heading anchors.
- Initial build conformance audits and the multi-agent team brief removed from `animae/docs/` (historical copies kept elsewhere in the workspace).
- [cel-reference.md](./cel-reference.md) documents CEL missing map-key semantics (`world.vars` / character `vars`).

### `@animae/engine`

- **TurnChunk utterance contract:** optional `newUtterance` on `text` chunks; shared accumulator (`createUtteranceStreamState`, `applyTextTurnChunk`, `closeUtteranceStream`); timeline replay marks utterance boundaries for playback.
- **Player line chunk:** a non-autonomous turn streams the player's own line (typed text, or the text of the chosen option) as its first `text` chunk, marked `newUtterance`; `replayChunks` reproduces the same stream from the timeline, so a replayed scene reads like the live one.
- **Model call log:** in-memory ring buffer (`createModelCallLog`, `withModelCallLog`, `writeModelCallLogJsonl`, `redactSecrets`); opt-in via `createEngine({ modelCallLog })`.
- **CEL `model` context:** `model.slot` and `model.tags` (from `ModelPort.tags`) for knowledge `when:` and prompt assembly (`modelCelExtra`).
- **Preset display strings:** `collectPresetDisplayStrings` merges locale tables from the preset extends chain for server-side snapshot localization.
- **Prompt language fixes:** the autonomous exchange after a player turn now inherits that turn's `outputLocale` (it used to fall back to the engine default, so English clients got every second reply in the content language); cue and event descriptions written as `$t:key` resolve in the prompt locale instead of reaching the model as raw markers (`Kernel.displayText`, `StringTableCache.lookup`); style examples are labelled as voice references when the output language differs; an optional name glossary (`character.<id>.name` / `.nickname` string keys) keeps names consistent with the interface.
- **Multi-character prompts:** the render user message names the speaker, and history lines of other characters are sent as named `user` messages instead of `assistant` messages (see [modules/pipeline.md](./modules/pipeline.md)).

### `@animae/engine` (earlier)

- **`Engine.scene.active()`** (and the `scene.active` RPC method): the scene that is open on the current timeline right now, or `null`. Hosts re-sync from it instead of trusting a cached scene id, which went stale when a scene ended, a timeline was loaded / rewound / switched, or a second client ended the scene.
- Mutation gate: the single-writer gate re-opens when the **last** joined caller releases, whatever the release order. Overlapping flows no longer leave it stuck busy.
- Hot reload keeps the content locale chain: a refreshed mod/overlay view reads the localized files the session started with instead of silently swapping to the unlocalized base.
- Appraisal coercion: an `approach` that is not in the policy's approach list is dropped instead of being passed through as free text.
- Render prompt: when the working prompt language differs from the output language, the user message now ends with the output-language directive written in the output language itself (the persona/examples in the working language no longer win the last-instruction contest).
- Structured-output salvage: JSON that is cut off by the token limit or contains raw control characters inside strings is repaired (`repairJsonText`) instead of failing the turn with `MODEL_OUTPUT_INVALID`; a cut-off reply keeps its text, half-written cues/choices are dropped.
- A rule that ends the scene in the middle of a turn (a stop word, a scripted ending: a `scene.ended` draft from an adjudicate-stage rule) no longer fails the rest of that turn with `TURN_FAILED` (`null is not an object`). Field resolution uses the scene as the turn found it, the turn still renders and commits its reply, and no autonomous exchange is attempted in the closed scene (`scene-ended-mid-turn` test).
- Reflection at the end of a scene: keys a model adds on its own (`confidence`, `reason`, `mood`) are ignored instead of rejecting the whole reflection, and an unusable reflection (schema failure, provider error) is skipped with a `REFLECTION_FAILED` warning instead of failing `scene.end`. A replay miss still fails. The literal `(no summary)` placeholder is no longer written into memory.
- Adjudicate-stage CEL now sees the turn's scene (`scene.location`, `scene.participants`, …) like the check and decide stages do; before, windows / thresholds / custom rules read an empty fallback scene there.
- Introspection: `characters/<id>/alias` and `characters/<id>/alias/nickname` expose a character's runtime nickname, aliases and per-speaker address labels (same visibility rules as the character); the `debug` viewer can also read `policy` and `state`, and `characters/<id>/card` (the full authored card, extension fields included; never granted to a game viewer, whatever the policy says). `docs/modules/introspect.md` now states that paths are slash-separated and that anything unrecognised (`world.vars`, `world.location`) answers `undefined`.

### `@animae/host`

- **`consumeTurnStream`:** one transcript entry and one Web stream start/end pair per utterance; `onStreamDelta` emits fragment deltas.
- **`localizeSnapshot`:** per-viewer localization of snapshot/events before Web wire transfer; preserves optional `i18n` refs on transcript and actions.
- **Late-bound keys:** preset and host keys resolve against the merged catalogs (preset `strings`, then host copy) through an optional `has` probe, so a key never logs a missing-key warning for the namespaces it is not in; a key nobody knows is shown humanized, never as a raw `<namespace>:<key>` marker. `bindLocalizeTranslator` is exported for event and toast localization.
- Built-in **`:llmlog`** command when `modelCallLog` is enabled (`llmlog-command.ts`).

### `@animae/host` (earlier)

- `syncSceneFromEngine(engine, state, actor)`: every scene read re-aligns the host's cached scene with the engine's (engines without `scene.active`, such as test doubles and thin RPC proxies, keep the cached value). `timeline.load` / `rewind` / `switch` / `import` can no longer leave a stale id that fails every later turn with `SCENE_INVALID`.
- Colon commands, palette actions and player turns run under one exclusive control (`TURN_IN_PROGRESS` when busy); `endday` has an in-flight guard (a double click warns instead of ending two days); `cancelActive` also clears a pending command.
- Free text is capped at `SessionHost.maxPlayerInputChars` (4096; colon commands exempt) → `INPUT_TOO_LONG`.
- Player-facing host text follows the **requesting client's** locale (`scopedI18n`).
- `buildSnapshot()` / the default header read `world/location` (the dotted spelling never matched anything, so the snapshot's scene and header location were always empty). The snapshot no longer carries the always-empty `jobs`, `resources`, `factions`, `calendar`, `achievements` keys; games publish such data through panels.

### `@animae/cli`

- `animae run` without `--scene` starts in the world's start location (`world/location`); it silently fell back to `home` before because the lookup used a dotted path.

### `@animae/web`

- Protocol messages **`llm_log`** / **`llm_log_clear`** for the in-memory model call log (when enabled on the engine).
- **`stream` frames** follow utterance boundaries (fragment deltas, one start/end per utterance).
- The frame timing contract for clients (when `busy` is reported, how far the transcript can trail `busy: false`, why turn controls should lock at the click) is written down in [modules/web.md](./modules/web.md).

### `@animae/web` (earlier)

- Protocol `error` frames carry `localized`: `true` means `message` was rendered in the client's locale and can be shown as-is; otherwise it is a diagnostic and clients present their own copy for `code`.
- Engine events forwarded to clients are localized field-by-field and keep their shape (a root-level `i18n` field no longer collapses a whole event into a string).
- Frames from one client are processed in order (`cancel` overtakes the turn it stops); snapshot pushes are single-flight and coalesce overlapping triggers (`session-room-queue`, `session-room-snapshot` tests); a controller disconnect cancels its running turn; every frame is handled inside the requesting client's locale scope.

### `@animae/i18n`

- `scopedI18n(base)` re-binds a process-wide translator to the request-scoped locale (`runWithLocale`), so servers do not leak the process locale into per-client output.
- Dotted keys are read as `namespace.path` only when the first segment is a registered namespace; nested catalog groups such as `role.controller_lost` resolve inside the default namespace.

### `@animae/tui`

- The cached scene is re-read from the engine (`syncLiveScene`) before it is used; ending a scene that is already gone is silent, any other failure is shown localized.
- The default header shows the chapter's title (its id when there is none) instead of `[object Object]`: `world/chapter` answers `{ id, title? }`, not a string.
- `RunTuiOptions.displayName`: host-provided display names for character ids. Transcript speaker labels and the participant panel read identities through the viewer's `engine.query`, which is redacted for the `player` viewer, so dialogue was labelled with the raw id (`npc1:`); the host resolver (then the identity query, then the id) now supplies the name.
- Test harness hook: with `TUI_PTY_DRAFT_FILE` set, the TUI also mirrors the turn-pending flag (third line) so external PTY harnesses can wait for turns to finish instead of sleeping.
- All user-visible text lives in `locales/{en,zh-CN}/tui.json`; `test/hygiene/no-hardcoded-ui-text.test.ts` rejects literals in components. `scripts/pty_locale_harness.py` drives the TUI in both locales.
- Layout: the frame is exactly as tall as the terminal; the chrome keeps its height and only the main region clips. Long output used to overlap itself and run into the input line (Ink paints a `Text` child's full content even when Yoga shrinks its box); `Viewport` / `Stack` give every region non-shrinking children and `overflow="hidden"`, and the transcript is anchored to its tail. See the *Layout contract* in `docs/modules/tui.md`.
- Modals (`Overlay`) are rendered in place of the transcript and side panel (`OverlaySlotProvider` / `useOverlaySlot`) instead of below the frame, so the header and the input line never move.
- Side panel: scrolls by laid-out size with a `▲ n · ▼ m` indicator (wheel, PgUp/PgDn), and generic sections (participants, tracks, fields, anchor) disappear while empty.
- Mouse wheel events go to the topmost target registered with `wheel: true`.
- System output is stored one transcript entry per line, with ids that stay unique after the 400-entry trim.
- Budget footer reads `budget` only; the dead `director/beat/budget` fallback is gone.
- Two chrome strings that were still hard-coded (`(Tab to focus)`, `(Esc to close)`) moved to `locales/*/tui.json`; the hygiene test now also scans `{"..."}` literals, literals that start with `(` or `[`, and sentences that merely contain a key name.
- `scripts/pty_lib.py` decodes the PTY stream incrementally, so multi-byte characters split across reads no longer show up as U+FFFD.

### `animae` CLI

- User-facing CLI text moved to `packages/cli/locales/{en,zh-CN}` and is covered by `animae i18n check`.

## 1.0.0

First production release of the Animae engine monorepo.

### `@animae/engine`

- Full turn pipeline (appraise → check → adjudicate → fields → intent → route → render → commit) with deterministic RNG and append-only timeline.
- Authored data loaders (Zod schemas in `schema/authored.ts`, `schema/policy.ts`), policy merge (`$append` / `$prepend`), preset `extends` chains.
- JSON-RPC 2.0 sidecar API; `createEngine` public surface per `api.ts`.
- Record / replay / live model modes via AI SDK v7 adapter.
- Extension events documented in `events.ts` (director, fields, rules, scene lifecycle).
- **Content mods:** layered overlays, patch merge, `ModBundle`, CLI `mods` subcommands, timeline mod record + drift warnings ([mods.md](./mods.md)).

### Packages

- `@animae/preset-base` — default tracks, intent, visibility, memory baseline.
- `@animae/preset-dnd` — SRD 5.2.1 social/exploration checks and trait schema (CC BY 4.0 attribution via `notice` export).
- `@animae/tui` — Ink 8 default layout, theme, keymap, colon commands hook.
- `animae` CLI — `init`, `validate`, `run`, `inspect`, `timeline`, `serve --stdio`, compiled `dist/animae` binary.

### Docs

- Authoring, policy, CEL, pipeline/events, RPC, embedding, and module notes under `animae/docs/`.
