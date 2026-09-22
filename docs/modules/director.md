# Director module (`@animae/engine` / `src/director`)

## Purpose

Narrative director ([Section 11](../spec.md#11-narrative-director)): **anchors**, **beats**, **sidenotes**, and **exceptions**, driven off the event log and `FieldSystem` grants.

## Public API

- `createDirector(k: Kernel): Director` — uses `k.m.fields` for soft/force/beat grants
- `hasVerbatimEcho(note, generated, minRun?)` — sidenote echo detection (default 8 chars)
- `anchorTargetMet`, `anchorsReferencing` — anchor helpers

### `Director`

| Method | Role |
|--------|------|
| `tick(when)` | Anchors + beats; returns grants, events, `nearestAnchorScenes`, `anchorNear` |
| `sidenote(npc, text, opts?)` | `sidenote.added` (default `ttlTurns: 3`) |
| `sidenotesFor(npc)` | Active sidenotes |
| `afterRender(npc, generated)` | Non-verbatim echo → `sidenote.echoed`; expiry → `sidenote.expired` |
| `invokeException(id, target)` | Charge check → `exception.used`, arms bypass for this turn |
| `bypassArmed(what)` | `field_cap`, `cost_due`, `track_cap`, `rule:*`, `constraint:*` |
| `anchorsReferencing(ref)` | Anchors referencing a character/knowledge id |
| `beatNote()` | Active beat `note` text for prompts |

Clear exception bypass on `tick("turn_end")`.

## Anchor targets (`target.spec`)

| Kind | Spec shape | Met when |
|------|------------|----------|
| `world_event` | `{ event: <kind>, match?: <CEL> }` | Recent event of that kind; optional CEL with `event` in context |
| `info_arrival` | `{ tags?: string[], claim?: {s,p,o}, knowledge?: id }` | Matching `info_arrival` event payload |
| `character_state` | `{ character: id, when: <CEL> }` | CEL true in character context |
| `character_choice` | `{ character: id, choice: tag }` | `choice.taken` for character with matching choice id/tag |

## Anchor strategies

- **soft** — When less than one `calendar.sceneMinutes` remains before deadline and status is `pending`: grant `soft` field (`source: "anchor"`), emit `anchor.progress` stage `soft`
- **hard** — Deadline reached and target not met: `anchor.fallback` + `hard` event drafts
- **force** — Last turn before deadline: grant `force` field (L2; subject to field grants policy), `anchor.progress` stage `force`

Deadline: `WorldTime` or CEL (absolute minutes or bool). Fulfilled → `anchor.fulfilled`.

`nearestAnchorScenes` / `anchorNear` use `policy.router.triggers.anchor_near.n`.

## Beats

Ordered list; at most one active. On `scene_start` / `turn_start` / `time_advanced`: evaluate `exit` then next `enter` CEL; `beat.entered` / `beat.exited`; grant beat `fields` via `FieldSystem.grant`.

## `time_advanced`

`world.advance` runs `tick("time_advanced", { asOf })` at sorted interior checkpoints in `(from, to]` (soft/force/deadline minutes per anchor; scene grid when beats exist), then emits `time.advanced`, then a final `tick("time_advanced")` at destination time. Checkpoint ticks stamp event `t` with `asOf`. Terminal anchor statuses (`fulfilled`, `fallback`) skip further fallback/progress. Each transition emits once per anchor.

## Sidenotes

Injected into dynamic prompts. `verbatim: false` — if generated text contains a run of ≥ 8 characters from the note, emit `sidenote.echoed`.

## Exceptions

`exceptions.yaml`: `charges`, `period` (`session` | `day` | `chapter`), `mayBypass[]`. Period key from session id, world day, or calendar chapter. One charge per `invokeException`; bypass cleared at turn end.
