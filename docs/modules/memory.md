# Memory module

## Purpose
Per-character episodic/semantic memory (`artifacts/<npc>/memory.jsonl`), knowledge injection (§9.2), retrieval scoring (§9.3), forgetting, distortion, gossip propagation, and scene-end S2 reflection (§9.7).

## Public API
- `createMemoryService(k: Kernel): MemoryService`
- `memoryCacheFor(k, owner): MemoryEntry[]` — sync snapshot for introspect (populated after `list` / `retrieve` / `write` on that owner).
- `memorySyncList(k, owner)` — same cache read.

### MemoryService (see `contracts.ts`)
| Method | Notes |
|--------|--------|
| `write` | Skips persist for `lod: extra`; ids `mem_<seq>_<n>`; emits `memory.written`. |
| `list` | Forgetting filter unless `includeForgotten`. |
| `retrieve` | Linear scan; optional vector blend when `k.embedding` set; `suppressTags` excludes entries. |
| `knowledge` | `always` / `when` (CEL) / `on-demand` index (cap `indexMax`). |
| `readDoc` | Load knowledge body by catalog id. |
| `distort` | Deterministic via `k.timeline.rng(rngKey)`; emits `memory.distorted`. |
| `propagateTick` | Daily; `shareable` entries along `relations[].share`. |
| `reflect` | No-op when `reflection.enabled === false`. S2 `reflect` label; optional `participants` (scene end passes roster after `scene.ended`). `defer` queues `{ sceneId, participants }`. |
| `flushDeferred` | Runs deferred queue FIFO at scene start (before new scene events). |
| `summaryFor` | Text for semi-static segment (summaries + top memories, no LLM). |

## Storage
- Entries: `timelines/<branch>/artifacts/<npc>/memory.jsonl` (via `ArtifactStore`, path `<npc>/memory.jsonl`).
- Summaries: `artifacts/<npc>/summaries/<id>.md` with YAML frontmatter.

## Decisions
- Parsed jsonl cached per `(branch, owner)`; invalidated on write.
- Vector embeddings cached in-memory per branch/doc id (not persisted).
- Propagation once per `(entryId, target)` per session (plus `carriedFrom` dedup on disk).
- Reflection summaries stored only when at least one proposal accepted.

## Edge cases
- No embedding port: retrieval is term/recency/importance/salience only.
- Character-scoped knowledge is visible only to that owner unless `scope: world` / matching location/scene.
- `extra` LOD: `write` returns `undefined` and does not append.
