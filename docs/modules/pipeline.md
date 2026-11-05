# Pipeline (prompt, appraise, render)

## Purpose

LLM-facing stages for the turn pipeline ([Section 8](../spec.md#8-cognitive-pipeline), [Section 17](../spec.md#17-routing-budget-s2-tiers-and-caching)). Turn orchestration lives in `pipeline/run-turn.ts` (H2).

## Public API

```ts
buildPromptSegments(k: Kernel, i: PromptInput): PromptSegments
measurePromptSegments(segments: PromptSegments): Record<string, { chars: number; tokensEst: number }>

appraiseStage(k: Kernel, t: TurnCtx, i: AppraiseInput): Promise<AppraiseStageResult>
renderStage(k: Kernel, t: TurnCtx, i: RenderInput): AsyncGenerator<RenderPart, RenderResult>

buildAppraiseSchema(policy: ResolvedPolicy): ZodType
buildRenderSchema(policy: ResolvedPolicy): ZodType

coerceAppraiseRaw(raw, policy): Record<string, unknown>
coerceRenderRaw(raw): Record<string, unknown>
parseJsonLoose(text: string): unknown
```

Types: `src/pipeline/types.ts`.

**Turn extensions:** `TurnCtx.promptExtraStatic` / `promptExtraDynamic` merge into render segments (mods use this for pack-specific static/dynamic blocks). Stage hooks registered on the engine may take an optional third argument `(ctx, next, kernel)`.

**The `render` stage hook:** `next()` resolves to `{ result, parts }`: the finished `RenderResult` and the chunks the stage produced, in order. What the hook returns is what is shown and what is committed. While a `render` hook is registered nothing of the reply is streamed until the hook returns; without one, text and narration reach the consumer as the model writes them.

**CEL `event.text`:** the player line for this turn (from `input.received`, including choice text), not the NPC reply. Rule stages pass it via `rulesDeps` in `run-turn.ts`. Render passes `playerText` into `buildPromptSegments`, which merges it into CEL `event.text` when evaluating knowledge `when` and building dynamic context.

**Input class hooks:** see [policy-reference — `input.response`](../policy-reference.md#inputresponse).

## Integration (H2)

`pipeline/stages-default.ts` resolves to these exports. `createEngine` uses `createRouter` from `router/`.

## Prompt segments ([Section 17.5](../spec.md#175-prompt-segments))

Deterministic ordering; **locked secrets never appear**; unlocked secrets only in **static**; other characters' secrets never injected unless shared by memory rules.

- **Scaffolding language:** section headings and output-contract copy come from `src/prompts/{locale}/sections.json` in the engine **prompt locale** (`Kernel.i18n.promptLocale`). Authored persona/world text stays in the content locale; a single output-language line inside the merged output contract states the player-visible language (from `outputLocale`).
- **Merged output contract:** one static block covers JSON shape, `text` vs cues, a single `intent_realized` line, cue types (with `$t:` descriptions resolved), and choices — the dynamic block names the decided intent id without repeating those rules; no duplicate language or cue rules elsewhere.
- **Static ordering:** identity → persona/style/limits → `x.prompt.world_facts` (or `world.rules_text`) → render-only `x.prompt.render` → merged output contract → priority-budgeted `always` knowledge (render only). Appraise static is `x.prompt.appraise_static` plus the stage's own constant instructions (task, event types with `$t:` descriptions resolved, examples; `PromptInput.extraStatic`) so they stay in the cacheable segment; the appraise dynamic segment carries only per-turn extras (`PromptInput.extraDynamic`, e.g. the quick-reply hint). Appraise gets no `always` or contextual (`when`) knowledge, no template-partial narration guidance, no render contract and no location atmosphere text (its scene section names the place only): it only classifies.
- **Recall:** retrieved memories and knowledge excerpts are plain lines without ids or scores; knowledge excerpts are capped in count and length (`render.recall.*`), and a document the prompt already carries in full (always-injected in static, contextual in dynamic) is not repeated as an excerpt.
- **Game instructions** (tone, few-shots) come from `policy.x.prompt.*`, `policy.x.tier_directives`, `policy.x.tag_vocabulary`. Relation lines use localized track/tier labels (`compactRelationLine`).
- **Render output:** schema `{ narrations?[], text, cues[], intent_realized, choices?[] }` ([Section 8](../spec.md#8-cognitive-pipeline)). A reply without `text` is invalid (LLM path: repair retry, then `RENDER_FAILED`). `coerceRenderRaw` maps common alias keys to `text`. Optional `narrations[]` become `narration` events and stream as `TurnChunk.narration` before character `text`.
- **Other LLM calls:** `buildEntityGeneratePrompt` (entity templates), `buildReflectionPromptSegments` (scene-end reflection), `buildNarrateLocationPrompt` (offscreen location traces) — all catalog scaffolding, no TypeScript English literals.
- **Name references:** authored prose may use `{{name:<characterId>}}`; `promptText` / `prepareAuthoredProse` expand via `entityDisplayName` (runtime nickname wins). `Engine.display.resolve` expands after `$t:` for UI. Unknown ids warn at `animae validate` (`NAME_REF_UNKNOWN`).
- **Prose hygiene:** HTML comments, mod stub bodies (`<!-- LLM body: … -->`), and frontmatter-only append overlays are stripped at load or merge (`prose/for-prompt.ts`, mod `card.append.md` merge).

- **Who speaks.** The closing `render` user message names the speaking character ("generate X's in-character response; speak only as X"). With one speaking character, history lines map one to one to chat messages. As soon as the window holds a reply from another character, only the speaker's own replies stay `assistant` messages and every other line (the player's and other characters') becomes a `user` message prefixed with its speaker's display name (`historyToMessages`), so a model does not mistake another character's reply for its own earlier words and continue in that voice.
- **Scene-scoped history.** `buildRecentHistory(k, speaker, addressee, limitTurns?, scope?)` filters timeline `input.received` / `utterance` events by scene participation before applying K ([spec section 8](../spec.md#8-cognitive-pipeline)). `runTurn` passes the active scene; reflection callers pass `{ sceneId, participants }` after `state.scene` is cleared. Reflection prompts already filter events by `sceneId`; memory recall is per speaker and does not replay other scenes' dialogue.
- **Output language.** The language directive, style-example heading, and name glossary are described in [i18n.md](../i18n.md#keeping-replies-in-the-output-language).

Appraise **user** message wraps actor text in `<<<ACTOR_INPUT>>>` … `<<<END_ACTOR_INPUT>>>` so injection strings are not treated as system instructions.

**Segment caps:** optional `policy.render.maxSegmentChars.{static,semiStatic,dynamic}` (characters). When set, `assembleBudgetSections` drops **whole** low-priority sections (ids recorded on `PromptSegments.diagnostics.droppedSections`, not in the prompt); as a last resort trims the lowest kept section on a paragraph/sentence boundary — never emits a truncation marker. `always` knowledge is lower priority than identity/limits. Optional `policy.render.knowledgeIndexMax` caps the on-demand index; the index appears only for **S2 render** (tools enabled), excluding docs already inlined as `always`/`when`.

**Prompt lint:** `lintAssembledPrompt(text)` (tests + hosts) asserts no `$t:`, unresolved `{{…}}`, HTML comments, truncation markers, frontmatter fences, internal ids (`scn_`/`evt_`), raw JSON event lines, or duplicate paragraphs.

## Classify

No separate stage; `input.classified` draft comes from appraise (`CLASSIFY_IN_APPRAISE`).

## Appraise / render robustness

- Zod schemas **preprocess** via `coerceAppraiseRaw` / `coerceRenderRaw` (enum casing, 0–100 → 0–1 intensity, tag normalization).
- `postProcessAppraisal` clamps and maps unknown event types to `other`.
- Model adapter **repair** retry on schema validation failure (one extra system hint).
- Render **cues** validated post-stream; unknown types or `at` out of range are dropped (no throw).

## Other stage behaviour

- **Retrieval**: `RenderInput.hits` optional; when absent, render retrieves with `appraisal.search_terms` + salience, then `memory.distort`.
- **S2 tools**: `search`, `read`, max 3 steps; tool descriptions come from `sections.json` in the prompt locale (not hard-coded English).
- **Streaming text / narration**: prefix-consistent deltas only; narration uses the same fragment rules as `text` with `newParagraph`.
- **Stream reset**: LLM render failure with `runtime.fallbackOnError.render` emits `TurnChunk.reset` then rule-backend stream ([Section 8](../spec.md#8-cognitive-pipeline)).
- **Mismatch retry**: `policy.render.retryOnMismatch === 1` buffers first LLM attempt until `intent_realized` known (rule backend never mismatches).
- **Choices**: CEL filter; ids `c1..cn`; drafts `choice.offered` / `choice.filtered`.
- **L4 field effects** in dynamic only: `hide_entities`, `disguise`, `inject_belief` (NPC view).

See also [router.md](./router.md) and [pipeline-and-events.md](../pipeline-and-events.md).
