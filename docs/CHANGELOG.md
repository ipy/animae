# Changelog

## Unreleased

### `@animae/engine`

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

- `syncSceneFromEngine(engine, state, actor)`: every scene read re-aligns the host's cached scene with the engine's (engines without `scene.active`, such as test doubles and thin RPC proxies, keep the cached value). `timeline.load` / `rewind` / `switch` / `import` can no longer leave a stale id that fails every later turn with `SCENE_INVALID`.
- Colon commands, palette actions and player turns run under one exclusive control (`TURN_IN_PROGRESS` when busy); `endday` has an in-flight guard (a double click warns instead of ending two days); `cancelActive` also clears a pending command.
- Free text is capped at `SessionHost.maxPlayerInputChars` (4096; colon commands exempt) → `INPUT_TOO_LONG`.
- Player-facing host text follows the **requesting client's** locale (`scopedI18n`).
- `buildSnapshot()` / the default header read `world/location` (the dotted spelling never matched anything, so the snapshot's scene and header location were always empty). The snapshot no longer carries the always-empty `jobs`, `resources`, `factions`, `calendar`, `achievements` keys; games publish such data through panels.

### `@animae/cli`

- `animae run` without `--scene` starts in the world's start location (`world/location`); it silently fell back to `home` before because the lookup used a dotted path.

### `@animae/web`

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

First production release of the Animae monorepo and example host game.

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

### example-game (`games/<host>`)

- Shipped TUI game on preset-dnd + `policies/example-game.yaml`, embedded data, `dist/example-game` binary.

### Docs

- Authoring, policy, CEL, pipeline/events, RPC, embedding, and module notes under `animae/docs/`.
