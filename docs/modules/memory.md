# Memory module

## Purpose
Per-character episodic/semantic memory (`artifacts/<npc>/memory.jsonl`), knowledge injection ([9.2](../spec.md#92-knowledge-documents-and-frontmatter-injection)), retrieval scoring ([9.3](../spec.md#93-retrieval)), forgetting, distortion, gossip propagation, and scene-end S2 reflection ([9.7](../spec.md#97-reflection)).

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
| `knowledge` | `always` / `when` (CEL) / `on-demand` index (cap `indexMax`). `always` bodies land in the **static** prompt segment (index lines in semi-static); see [17.4 Prompt segments](../spec.md#174-prompt-segments) and [architecture — turn pipeline](../architecture.md#43-turn-pipeline-per-sceneturn). |
| `readDoc` | Load knowledge body by catalog id. |
| `distort` | Deterministic via `k.timeline.rng(rngKey)`; emits `memory.distorted`. |
| `propagateTick` | Daily; entries with `shareable: true` or a `shareable` tag along `relations[].share`. |
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
- The reflection answer is model output: unknown keys are ignored, and an answer that still fails the schema (or a provider error) skips that owner with a `REFLECTION_FAILED` warning (`config.warning`) so `scene.end` always completes. `RECORDING_MISSING` in replay mode is not swallowed.

## Edge cases
- No embedding port: retrieval is term/recency/importance/salience only.
- Character-scoped knowledge is visible only to that owner unless `scope: world` / matching location/scene.
- `extra` LOD: `write` returns `undefined` and does not append.
