# Pipeline (prompt, appraise, render)

## Purpose

LLM-facing stages for the turn pipeline (§8, §17). Turn orchestration lives in `pipeline/run-turn.ts` (H2).

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

## Integration (H2)

`pipeline/stages-default.ts` resolves to these exports. `createEngine` uses `createRouter` from `router/`.

## Prompt segments (§17.4)

Deterministic ordering; **locked secrets never appear**; unlocked secrets only in **static**; other characters' secrets never injected unless shared by memory rules.

- **Engine instructions** (JSON-only output, stay in character, render `text` vs cues, decided intent as imperative + `intent_realized` echo rule, S1/S2 length hints) live in `prompt.ts`.
- **Static ordering:** identity, persona (sub-cap when `maxSegmentChars.static` set), limits, and secrets are assembled **before** world rules, cue/choice specs, and priority-budgeted `always` knowledge so segment caps truncate low-priority tail first.
- **Game instructions** (tone, few-shots, tier behavior copy) come from `authored.world.rules_text` and optional `policy.x.prompt`, `policy.x.tier_directives`, `policy.x.tag_vocabulary`.

Appraise **user** message wraps actor text in `<<<ACTOR_INPUT>>>` … `<<<END_ACTOR_INPUT>>>` so injection strings are not treated as system instructions.

**Segment caps:** optional `policy.render.maxSegmentChars.{static,semiStatic,dynamic}` (characters). When set, segments truncate with `[…truncated to segment budget…]`; `always` knowledge uses priority order before truncation. Default: unlimited (gameplay-agnostic).

## Classify

No separate stage; `input.classified` draft comes from appraise (`CLASSIFY_IN_APPRAISE`).

## Appraise / render robustness

- Zod schemas **preprocess** via `coerceAppraiseRaw` / `coerceRenderRaw` (enum casing, 0–100 → 0–1 intensity, tag normalization).
- `postProcessAppraisal` clamps and maps unknown event types to `other`.
- Model adapter **repair** retry on schema validation failure (one extra system hint).
- Render **cues** validated post-stream; unknown types or `at` out of range are dropped (no throw).

## Other stage behaviour

- **Retrieval**: `RenderInput.hits` optional; when absent, render retrieves with `appraisal.search_terms` + salience, then `memory.distort`.
- **S2 tools**: `search`, `read`, max 3 steps.
- **Streaming text**: prefix-consistent deltas only.
- **Mismatch retry**: `policy.render.retryOnMismatch === 1` buffers first attempt until `intent_realized` known.
- **Choices**: CEL filter; ids `c1..cn`; drafts `choice.offered` / `choice.filtered`.
- **L4 field effects** in dynamic only: `hide_entities`, `disguise`, `inject_belief` (NPC view).

See also `animae/docs/modules/router.md`, `games/lilium/docs/prompts.md`.
