# End-to-end tests

## Purpose

Integration tests that drive the real engine (and, per suite, the real web server, CLI binary or TUI) on temporary directories. Model calls are always served by `ScriptedModel` (or the rule backend); nothing touches the network. The engine, web and CLI suites check the event-log invariants of the spec (`assertLogInvariants`: `because` + `source` on every event, snapshot equals replay, record→replay equality) on the timelines they produce.

| Suite | Location | Tests |
|-------|----------|-------|
| Engine | `packages/engine/test/e2e/` | 118 (28 files) |
| Web + host sockets | `packages/web/test/e2e/` | 21 (5 files) |
| CLI process | `packages/cli/test/e2e/` | 22 (6 files) |
| TUI | `packages/tui/test/e2e/` | 30 (4 files) |

Run everything from the repository root with `bun test`, or one suite with `bun test <location>`.

## Engine fixture

`test/e2e/fixture.ts`: `seedE2eAuthored`, `e2ePreset` (embedded policy bundle id `e2e`). `test/e2e/session-invariants.ts` holds the shared checks: `assertLogInvariants`, `assertSnapshotEqualsReplay` and the determinism helpers (`DETERMINISM_EXEMPT_EVENT_KEYS = ["sid"]`: session ids are the only intentionally non-deterministic event field).

`engine.e2e.test.ts` covers the basic engine loop:

- Multi-turn scene (streaming chunks, `input.received`, utterance, cues).
- Timeline save/load/rewind/diff.
- Record → replay: byte-stable event log (I6); rule-mode and rule-backend turns need no recordings ([Appendix D](../spec.md#appendix-d-replay-semantics)).
- Hot reload success/failure.
- Lock release + reopen.
- 1000× `world.set` sanity timing.

## World e2e (`world-*`)

| File | Focus |
|------|--------|
| `world-fixture.ts` / `world-invariants.ts` | Temp-root helpers, schedule id helpers, replay/snapshot checks |
| `world-time.e2e.test.ts` | Schedule, decks, decay, offsets, memory propagation ticks, snapshots |
| `world-director.e2e.test.ts` | Anchors, beats, sidenotes, exceptions, anchor `entity.generate` |
| `world-offscreen.e2e.test.ts` | Lazy catch-up, fidelity tiers, offscreen movement |
| `world-timeline.e2e.test.ts` | Branches, purge, crash-safe log, lock file |
| `world-mods.e2e.test.ts` | Mod overlay, reload (a failed reload keeps the configuration and logs `config.error`), hash merge |
| `world-gallery.e2e.test.ts` | Collection, capture/render, rule-mode unlock |
| `world-entities.e2e.test.ts` | Generate/spawn (characters, locations, items)/import, aliases and address-as labels, `entity.generate` live fulfillment |

## Session e2e (`session-*`)

| File | Focus |
|------|--------|
| `session-fixture.ts` / `session-invariants.ts` | Temp-root helpers, `assertLogInvariants`, snapshot vs full replay |
| `session-lifecycle.e2e.test.ts` | LLM three-character scene: streaming chunks, tracks/tiers, memory artifacts, reflection accept/reject, save/load/rewind |
| `session-rule-mode.e2e.test.ts` | Rule backend only (forbidden model port), mode switches, fallback, judge/narrate-only |
| `session-replay.e2e.test.ts` | I6 record→replay log/chunk equality, mixed backends, missing recordings |
| `session-budget.e2e.test.ts` | Router budget degrade, `secret_topic` / `mood_spike`, deferred reflection |
| `session-i18n.e2e.test.ts` | `setUiLocale`, per-turn `outputLocale`, `config.reloaded`, hot reload failure |
| `session-input-safety.e2e.test.ts` | `input.response` emit/intent/hook, `safety.flagged`, the four `safety.response` modes |
| `session-hooks.e2e.test.ts` | The `render` stage hook: pass-through, rewrite, no streaming before the hook returns |

Replay chunk equality follows `timeline.replay` / `replayChunks`, which derive chunks from committed `utterance` events (one full-line `text` chunk per utterance plus the logged cue/narration/done chunks). Live S2 streaming may emit more partial `text` chunks than replay; only the event log and the replay-derived chunk stream are I6-stable.

## Replay e2e (`replay-*`)

| File | Focus |
|------|--------|
| `replay-fixture.ts` / `session-invariants.ts` (`assertSnapshotEqualsReplay`) | Rich timeline builder, I2 snapshot vs full replay |
| `replay-snapshot.e2e.test.ts` | I2 after multi-scene LLM session (schedule, entities, fields, save/load/rewind, hot reload, purge); legacy `schedule.fired` reducer ids; reopen without model calls |
| `replay-determinism.e2e.test.ts` | I6 dual-engine log compare (`sid` exempt), record→replay across runtime modes, fallback turns, budget replay |

## Fields e2e (`fields-*`)

Field levels L0–L4, `track_caps`, router `secret_topic`, secret unlocking and introspection (`query`, `queryAsync`, `explain`, custom viewers):

| File | Focus |
|------|--------|
| `fields-fixture.ts` | Temp-root helpers, `fieldsPreset`, secrets/memory seed, `assertLogInvariants` via `audit()` |
| `fields-effects.e2e.test.ts` | `check_mod`, `intent_forbid`, `event_prob` prompt + CEL (`max`/`override`/`add`), L3 `rule_add`, L4 `inject_belief`, TTL, grant/revoke, I6 record→replay |
| `fields-track-caps.e2e.test.ts` | Intersecting `track_caps`, adjudicate clamp, revoke lift, holder scope (no cross-NPC leak) |
| `fields-secrets-router.e2e.test.ts` | Locked secret tag intersection vs addressee, literal `secret` tag, `route.decided` triggers/tier; `character.secret_unlocked` after the adjudicated turn; unlocked addressee stops `secret_topic` |
| `fields-introspect.e2e.test.ts` | `player` / `debug` / `registerViewer` query, explicit child-path deny, sync vs `queryAsync` catch-up, explain retrieval visibility |

## Memory e2e (`memory-*`)

| File | Focus |
|------|--------|
| `memory-fixture.ts` | Memory-focused presets, deterministic embedding port, authored seeds |
| `memory-retrieval.e2e.test.ts` | Multi-scene retrieval logs on `utterance`, reflection summaries, owner scope, `memory.distorted.owner` |
| `memory-propagation.e2e.test.ts` | `memory.propagation.onTick` (`day` vs `scene_end`), relation `share` gating, `memory.propagated` → `memory.written` id link |
| `memory-knowledge.e2e.test.ts` | Knowledge `inject` modes in S2 prompts; vector blend ordering |
| `memory-replay.e2e.test.ts` | I6 record→replay equality for utterance text and `retrieval` logs |

## RPC e2e (`rpc-*`)

| File | Focus |
|------|--------|
| `rpc-fixture.ts` | In-process line JSON-RPC session helper + zod result shapes |
| `rpc-session.e2e.test.ts` | Full method walk (`info`, scene, introspect, timeline, locale, display, entities, `mods`) |
| `rpc-errors.e2e.test.ts` | JSON-RPC error codes, blocked methods, EOF and oversized lines |
| `rpc-concurrency.e2e.test.ts` | Serialized overlapping `scene.turn`; response `id` correlation |

## Web + host socket e2e (`packages/web/test/e2e/`)

Real `createWebServer` (ephemeral port), Bun `WebSocket` + `fetch`, `SessionHost`, and `createEngine` with `MemoryStorage` / e2e fixtures (`ScriptedModel`, `createFakeImagePort`). Every server frame is validated with `@animae/web` `ServerMessageSchema`.

| File | Focus |
|------|--------|
| `e2e-fixture.ts` | Stack helper, `WsSession`, schema-safe parsing, polling |
| `e2e-http.test.ts` | Static assets, `/api/health` / `/api/version`, 404s, CSP, origin allow-list on port 0, asset + gallery image traversal |
| `e2e-ws-session.test.ts` | Turn journey (busy/stream/result/snapshot), spectator broadcast, late joiner, resume, commands/locale |
| `e2e-ws-resilience.test.ts` | Parse/validation errors, oversized WS close + peer recovery, input queue ordering, mid-turn disconnect, gallery job drop, partial replay |
| `e2e-gallery.test.ts` | Capture + job notices + `/api/gallery/image/` bytes; no ImagePort error |
| `e2e-lifecycle.test.ts` | `stop()` port release and rebind |

Pins host WebSocket protocol v1 and the event-log invariants I1–I5 on played turns.

## CLI process e2e (`packages/cli/test/e2e/`)

Spawns the real `bin.ts` entry via `Bun.spawn([process.execPath, …])` with scrubbed provider env and `--mode rule` for turn-playing commands. Helpers: `cli-process.ts` (spawn, stdio JSON-RPC client), `e2e-shared.ts` (temp roots, tutorial copy).

| File | Focus |
|------|--------|
| `cli-meta.e2e.test.ts` | `--help`, `--version`, invalid flags, missing args, unknown timeline subcommand |
| `cli-init-validate.e2e.test.ts` | `init`, `validate`, `mods` list/validate/explain, broken authored path diagnostics, `--lang` |
| `cli-serve.e2e.test.ts` | `serve --stdio` JSON-RPC journey (`mods`, `display.*`, blocked registrars), parse errors, I1 persistence across respawns |
| `cli-plain.e2e.test.ts` | `run --plain` piped stdin, rule-mode reply text, `:help` / `:query` / `:quit`, `--viewer`, EOF |
| `cli-tools.e2e.test.ts` | `inspect`, `timeline` list/save, cards, `gallery`, `i18n` (`beforeAll` tutorial copy) |
| `cli-determinism.e2e.test.ts` | Same seed + inputs → matching `events.jsonl` (I6; ignores `sid` / `createdAt`) |

The whole suite finishes in well under a minute.

## TUI e2e (`packages/tui/test/e2e/`)

Ink integration tests mount the real `TuiApp` on a mock TTY against `openRuleEngine()` (rule mode, no network). Input is driven with simulated keys and SGR mouse events; temp engine roots are disposed in `afterEach`.

| File | Focus |
|------|--------|
| `tui-app-engine.e2e.test.tsx` | Turns, palette, `:query`, locale, scroll, resize, errors, quit |
| `tui-app-live-flows.e2e.test.tsx` | Multi-turn transcript; choices appear after the stream ends and are ignored while a turn is pending; choice-by-digit |
| `tui-app-line-editing.e2e.test.tsx` | The input line and the choice menu: cursor keys, Backspace and Delete, the ends of the line, input history (also when steps arrive in one tick), Tab completion of colon commands, the slash palette; choice menu arrows and Enter |
| `tui-app-overlays.e2e.test.tsx` | The overlays and the timeline keys on the live engine: F2 event log, F3 timeline and branch switch, F4 explain, F6 mode panel, Ctrl+S / Ctrl+L save and load (selection stays on the list), Ctrl+Z rewind (confirm, decline, nothing to rewind, rewind forbidden by policy) |

## Host-level e2e (outside this package)

Hosts often add integration tests on a full authored data root (decay, schedule, anchors on `world.advance`, long `record` → copy → `replay` I6 checks). Keep those tests in the host repository; engine e2e stays fixture-based under `test/e2e/`.
