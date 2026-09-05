# Model module (`@animae/engine` / `src/model`)

## Purpose

AI SDK v7 adapter behind `ModelPort`: structured output (`Output.object` via `generateText` / `streamText`), tools with step limits, prompt cache breakpoints (§17.4), record/replay (§13), and test doubles.

## Public API

| Export | Role |
|--------|------|
| `createModelPort(spec, opts?)` | Live port for `anthropic` / `openai` / `google` / `deepseek` / `ollama` / `openai-compatible` |
| `withRecording(port, RecordingStore)` | `live` passthrough, `record` append, `replay` serve (no network) |
| `createModelsFromConfig(config, opts?)` | `{ s1, s2 }` from `animae.yaml` `models` (throws `MODEL_CONFIG` if either missing) |
| `resolveEngineModels(opts, config, portOpts?)` | Used by `createEngine`: explicit `opts.models` or config fallback (§19.3) |
| `createScriptedModel(id, handler)` | Deterministic port for tests |
| `streamFromObject(obj, chunkSize?)` | Growing `{ text }` partials for render streaming tests |
| `createEmbeddingPort(spec, opts?)` | Optional `embedMany` → `Float32Array[]` (engine wiring off by default) |
| `segmentsToMessages`, `recordingKey`, `resolveApiKey` | Helpers exposed for integrators/tests |
| `installAiSdkWarningHandler`, `ModelWarningSink` | Route AI SDK warnings off stdout/stderr |

### Options (`ModelPortOptions`)

- `env` — API key lookup (default `process.env`)
- `fetch` — passed to AI SDK
- `usageSink` — callback per completed call
- `warningSink` / `warningLogPath` — pluggable warnings (deduped; AI SDK uses `globalThis.AI_SDK_LOG_WARNINGS`)
- `sleep` / `maxTransientRetries` — retry tests & tuning
- `model` — inject `LanguageModelV4` (tests)

## Prompt segments (§17.4)

Order: **static** (system, Anthropic cache bp 1) → **semiStatic** (system, bp 2) → **dynamic** (system, uncached) → **history** → **user**. OpenAI/Google rely on stable prefix ordering for automatic prefix caching; Anthropic uses `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }` on the first two system blocks.

## Recording

Key: `sha256(stableJson({ model: port.id, label, segments, schema JSON Schema fingerprint, tool names, maxOutputTokens, maxSteps, temperature, seed }))`.

- `object`: stored value
- `stream`: full `StreamPart[]` (partials, tools, final) — replay re-yields the same sequence (I6). Tool `execute` is not re-run on replay.

Miss in replay: `AnimaeError("RECORDING_MISSING", key + label)`.

## Errors

| Code | When |
|------|------|
| `MODEL_CONFIG` | Invalid openai-compatible config (missing `baseURL`), missing `models` in config, unsupported embedding provider |
| `MODEL_OUTPUT_INVALID` | Schema validation failed after one repair pass |
| `RECORDING_MISSING` | Replay lookup miss |

Transient HTTP/network/429/5xx: bounded exponential backoff (default 3). Client validation 4xx: no retry. Missing API keys: warn once; 401 at request time.

## Decisions

- Uses `generateText` / `streamText` + `Output.object` (not deprecated `generateObject`) so tools and `stopWhen: isStepCount(maxSteps)` work together; default `maxSteps` 3 when tools are present.
- SDK `maxRetries` set to 0; transient retries implemented in the adapter with injectable `sleep`.
- Model id: `` `${provider}/${model}` `` from `ModelSpec`.
- **Ollama**: `ollama-ai-provider-v2` with `compatibility: "strict"` (native `/api/chat`, `/api/embed`).
- **DeepSeek**: `@ai-sdk/deepseek`; pass `options.thinking` / reasoning via `spec.options`.
- Structured outputs strip `thinking` / `reasoning_content` artifacts from string fields.

## Edge cases

- Empty segment strings are omitted (no empty system messages).
- `spec.options` forwarded as `providerOptions[provider]`.
- Repair pass adds a short system hint; one retry only for schema failures.
