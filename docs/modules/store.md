# Store module

## Purpose

POSIX-relative storage for the Animae data root: atomic writes, append with fsync, directory listing, and a single-writer lock.

## Public API

- `FsStorage(root: string): StoragePort` — Node/Bun filesystem backend.
- `MemoryStorage(root?: string): StoragePort` — in-memory backend for tests (same lock semantics).
- `assertRelativePath`, `joinPath` — path guards.
- `sha256Hex`, `stableStringify`, `parseYaml`, `stringifyYaml`, `parseFrontmatter`, `readYamlFile`, `readJsonl`, `appendJsonl`, `repairJsonlText`, `parseJsonlLines`.

## Decisions

- Paths must be relative (no leading `/`, no `..`, no backslashes).
- Writes use temp file + rename; appends open with `"a"` and fsync by default.
- `.animae.lock` holds the writer PID; stale locks (dead PID) are stolen; live foreign PID → `AnimaeError("LOCKED")`.
- `readJsonl` / event log open paths drop a truncated final line (crash safety).

## Edge cases

- Empty parent directory for root-level files (e.g. `saves.yaml`) is allowed.
- `list` returns direct child names; directories include a trailing `/`.
- `listFiles` is recursive and sorted.
