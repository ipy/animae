# Module: `authored`

## Purpose

Loads and validates all author-time content under the data root (spec §5, §6 file layout, §9.2 knowledge frontmatter, §12.2 world, §19 animae.yaml).

## Public API

- `loadAuthored(storage, opts?)` — reads YAML/MD files, merges preset templates/knowledge (authored wins), cross-reference checks, returns `Authored` with aggregate `hash` and per-file `files` sha256 map. Invalid config → `AnimaeError("CONFIG_INVALID")` with `file:path: message` lines.
- When using mod layering, pass a **layered** `StoragePort` plus `resolvedMods` / `modProvenance` in `opts` (see [mods.md](../mods.md)).
- `createCatalog(getAuthored, getGenerated)` — merged read view over authored + `EngineState.generated`.
- `displayName(def)`, `characterTags(def)`, `bottomLineTags(def)` — character helpers for other modules.

## Decisions

- Character id = directory name under `characters/`; optional `identity.id` in `card.md` must match.
- Knowledge ids: `world/<relpath-without-md>`, `character:<id>/<basename>`.
- Relation targets missing at load time emit warnings (not errors) so generated NPCs can be linked later.
- Optional authored files (`anchors`, `beats`, …) default to empty collections.

## Edge cases

- `world/fields/<id>.yaml` (one `FieldDef` per file, or an array in one file).
- `world/items/<id>.yaml`, director files under `world/` (`anchors.yaml`, `beats.yaml`, …).
- Preset knowledge paths are normalized under `world/knowledge/`; only `.md` / `.markdown` files are merged (YAML field templates are not knowledge).
- Hot-reload consumers compare `Authored.hash` / per-path entries in `Authored.files`.
