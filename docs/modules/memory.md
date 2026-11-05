# Memory module

## Purpose
Per-character episodic/semantic memory (`artifacts/<npc>/memory.jsonl`), knowledge injection ([9.2](../spec.md#92-knowledge-documents-and-frontmatter-injection)), retrieval scoring ([9.3](../spec.md#93-retrieval)), forgetting, distortion, gossip propagation, commit-time memory writing ([9.1](../spec.md#91-memory-entries)), and scene-end **S1** reflection ([9.7](../spec.md#97-reflection)).

## Public API
- `createMemoryService(k: Kernel): MemoryService`
- `memoryCacheFor(k, owner): MemoryEntry[]` — sync snapshot for introspect (populated after `list` / `retrieve` / `write` on that owner).
- `memorySyncList(k, owner)` — same cache read.

### MemoryService (see `contracts.ts`)
| Method | Notes |
|--------|--------|
| `write` | Skips persist for `lod: extra`; ids `mem_<seq>_<n>`; emits `memory.written`. Text/weights from `policy.memory.writing` (rule template or S1 `memory-write` when `backend: s1` and S1 is on a model). Commit also runs `writeNarrationMemory` when `memory.writing.narration` ≠ `none`. |
| `list` | Forgetting filter unless `includeForgotten`. |
| `retrieve` | Linear scan; optional vector blend when `k.embedding` set; `suppressTags` excludes entries. |
| `knowledge` | `always` / `when` (CEL) / `on-demand` index (cap `indexMax`). `always` bodies land in the **static** prompt segment (index lines in semi-static); see [17.5 Prompt segments](../spec.md#175-prompt-segments) and [architecture — turn pipeline](../architecture.md#43-turn-pipeline-per-sceneturn). |
| `readDoc` | Load knowledge body by catalog id. |
| `distort` | Deterministic via `k.timeline.rng(rngKey)`; emits `memory.distorted`. |
| `propagateTick(when?)` | When `propagation.onTick` is `day`, runs only on day-boundary ticks inside `world.advance` (`when: "day"`). When `onTick` is `scene_end`, runs only at scene end (`when: "scene_end"`). Shareable entries or a `shareable` tag propagate one hop along `relations[].share`. |
| `reflect` | No-op when `reflection.enabled === false`. S1-role `object()` with purpose `reflection` (or rule `summaryTemplate` when backend/rule mode demands); optional `participants` (scene end passes roster after `scene.ended`). `defer` queues `{ sceneId, participants }`. |
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
- The reflection prompt names every output field together with the shape of its items (`goal_changes`: `{action, id?, text, tags}`; `new_claims`: `{s, p, o}`) and lists the character's current goals with their ids, so `update` / `remove` can refer to one. All reflection text uses the output language.
- The reflection answer is model output: unknown keys are ignored, and an answer that still fails the schema (or a provider error) skips that owner with a `REFLECTION_FAILED` warning (`config.warning`) so `scene.end` always completes. `RECORDING_MISSING` in replay mode is not swallowed.

## Edge cases
- No embedding port: retrieval is term/recency/importance/salience only.
- Character-scoped knowledge is visible only to that owner unless `scope: world` / matching location/scene.
- `extra` LOD: `write` returns `undefined` and does not append.
- **`when` CEL errors:** a knowledge doc whose `when` expression throws (unguarded optional key, typo) is **skipped** for that turn; the engine emits one `KNOWLEDGE_WHEN_FAILED` warning per doc id (`k.warn`, params `{ id, path }`). The turn continues.
- Per-character files under `characters/<id>/knowledge/*.md` are loaded with the character bundle (`loadCharacterFromFiles`); scope `character:<id>` must match the owner.
