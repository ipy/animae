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

## Anthropic base URL

`baseURL` (or `ANTHROPIC_BASE_URL`) may be written the way the official SDKs expect — an origin or gateway prefix **without** `/v1` (e.g. `http://localhost:8080/anthropic`). The AI SDK provider only appends `/messages`, so the engine normalises the URL through `normalizeAnthropicBaseURL`: a missing `/v1` segment is added, an already-versioned URL (`https://api.anthropic.com/v1`) is kept, and a pasted full endpoint (`…/v1/messages`) is trimmed back to `…/v1`.

## OpenAI-compatible gateways with split `reasoning` / `content`

Some local proxies return `message.reasoning` with empty `content`, or stream deltas only on `reasoning`. The engine wraps `fetch` via `createReasoningAwareFetch` / `chainReasoningFetch`:

- Injects `reasoning_effort: none` on outbound `/v1/chat/completions` JSON bodies when unset.
- Promotes JSON from `reasoning` into `content` when `content` is empty; strips reasoning fields before the AI SDK parses responses.

Defaults: `resolveOpenAICompatibleProviderOptions` sets `reasoning_effort: "none"` in `providerOptions.openaiCompatible` (SDK may not map it; fetch injection is authoritative).

## Recording

Key: `sha256(stableJson({ model: port.id, label, segments, schema JSON Schema fingerprint, tool names, maxOutputTokens, maxSteps, temperature, seed }))`.

- `object`: stored value
- `stream`: full `StreamPart[]` (partials, tools, final) — replay re-yields the same sequence (I6). Tool `execute` is not re-run on replay.

Miss in replay: `AnimaeError("RECORDING_MISSING", key + label)`.

## Errors

| Code | When |
|------|------|
| `MODEL_CONFIG` | Invalid openai-compatible config (missing `baseURL`), missing `models` in config, unsupported embedding provider |
| `MODEL_OUTPUT_INVALID` | Schema validation failed after one repair pass **and** salvage found nothing usable |
| `RECORDING_MISSING` | Replay lookup miss |

Transient HTTP/network/429/5xx: bounded exponential backoff (default 3). Client validation 4xx: no retry. Missing API keys: warn once; 401 at request time.

## Decisions

- Uses `generateText` / `streamText` + `Output.object` (not deprecated `generateObject`) so tools and `stopWhen: isStepCount(maxSteps)` work together; default `maxSteps` 3 when tools are present.
- SDK `maxRetries` set to 0; transient retries implemented in the adapter with injectable `sleep`.
- Model id: `` `${provider}/${model}` `` from `ModelSpec`.
- **Ollama**: `ollama-ai-provider-v2` with `compatibility: "strict"` (native `/api/chat`, `/api/embed`). When `options.num_ctx` is omitted, the engine defaults **`num_ctx: 8192`** (Ollama’s own default is often 2048–4096 and truncates long system prompts silently). Set `options.think: false` on models that emit separate thinking streams; string fields still pass through `sanitizeStructuredOutput`. If estimated input tokens exceed ~85% of `num_ctx`, a **`OLLAMA_CTX_BUDGET`** warning is sent to the warning sink (not stdout).
- **DeepSeek**: `@ai-sdk/deepseek`; pass `options.thinking` / reasoning via `spec.options`.
- Structured outputs strip `thinking` / `reasoning_content` artifacts from string fields.

## Edge cases

- Empty segment strings are omitted (no empty system messages).
- `spec.options` forwarded as `providerOptions[provider]` (Ollama merges default `num_ctx` as above).
- Opt-in live check: `bun run smoke:ollama` in `@animae/engine` (requires local Ollama; not part of `bun test`). Exercises text, stream, Zod object + repair, `think` on/off, warning sink, and missing-key tolerance with tiny `num_predict`. On slow 8B models, expect tens of seconds per check; keep `options.think: false` unless you need separated reasoning.
- Repair pass adds a short system hint; one retry only for schema failures.
- **Salvage** (`salvageStructuredFromValidationError`) runs when the repair pass still fails, on the raw text the SDK kept: fenced JSON is unwrapped, prose without any `{` becomes `{ text }`, and JSON that is broken only by raw control characters inside strings or by a token-limit cut-off is repaired (`repairJsonText`: escape control characters, close the string and containers, drop a dangling key). A cut-off reply keeps just its `text`; half-written cues and choices are dropped, and a reply without text is still `MODEL_OUTPUT_INVALID`.
