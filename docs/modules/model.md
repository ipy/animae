# Model module (`@animae/engine` / `src/model`)

## Purpose

LLM adapter and rule backend behind `ModelPort`: structured output (`Output.object` via `generateText` / `streamText`), tools with step limits, S2 tier resolution, prompt cache breakpoints ([17.5](../spec.md#175-prompt-segments)), record/replay ([Section 13](../spec.md#13-timeline)), and test doubles. S1/S2 are **roles**; see [Section 2.1](../spec.md#21-s1-and-s2-are-roles).

## Public API

| Export | Role |
|--------|------|
| `createModelPort(spec, opts?)` | Live port for `anthropic` / `openai` / `google` / `deepseek` / `ollama` / `openai-compatible` |
| `withRecording(port, RecordingStore)` | `live` passthrough, `record` append, `replay` serve (no network) |
| `createModelCallLog`, `withModelCallLog` | In-memory debug log ([model-call-log.md](../model-call-log.md)) |
| `createModelsFromConfig(config, opts?)` | `{ s1?, tiers? }` from `animae.yaml` — omitted roles use rule backend only |
| `resolveEngineModels(opts, config, portOpts?)` | Used by `createEngine`: explicit `opts.models` or config fallback ([19.3](../spec.md#193-model-configuration)) |
| `createRuleModelPort(k)` | Deterministic `ModelPort` with id `rule`; dispatches on `ModelRequest.purpose` |
| `createTierResolver(tiers, routing?)` / `singleTierResolver(port)` | S2 tier ladder + `forJob(render\|offscreen\|autonomous\|escalate)` |
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
- `specRef` — mutable `{ current: ModelSpec }` for hot config (`syncModelPortSpec`)

### Request timeout (`ModelSpec.timeoutMs`)

Optional positive integer (max 3_600_000 ms). When omitted:

| Provider class | Default |
|----------------|---------|
| `ollama` | 600_000 ms (10 min) |
| all others | 120_000 ms (2 min) |

Semantics:

- **Non-streaming (`object`)**: total wall-clock limit for one attempt (AI SDK `timeout`).
- **Streaming (`stream`)**: an idle watchdog owned by the engine (`createStreamWatchdog`). It starts when the request is issued and restarts on every chunk of provider output, so it bounds connecting plus time-to-first-token (`phase: "first_chunk"`) and any later silence between chunks (`phase: "idle"`). Steady streaming is never capped by a total duration. The SDK's own `firstChunkMs` is deliberately not used: it only starts counting once the HTTP response is open, so a server that accepts the request and then stays silent would never time out. Structured output delivers chunks in coarse steps (the SDK holds text back until a partial object can be parsed), so very small limits are not meaningful.

Errors are classified once at the call site into `MODEL_TIMEOUT` (`params: { timeoutMs, seconds, phase }`), `MODEL_UNREACHABLE` (`params: { host }`, including Bun's `ConnectionRefused` / `FailedToOpenSocket` / `ConnectionClosed`), `MODEL_HTTP` (`params: { status, detail }`), `MODEL_EMPTY` and `MODEL_OUTPUT_INVALID`. On the stream path the SDK reports the real failure through `onError` and then rejects with a generic "No output generated"; the engine keeps the first real error so the classification (and the user-facing message) reflects the actual cause, and nothing is printed to the console.

Transient retries: timeouts are retryable at most **once** per call, in both `object` and `stream` (other transients — unreachable endpoint, HTTP 429/5xx — use `maxTransientRetries`, default 3). Worst-case wall clock for a single call is roughly `2 × timeoutMs` plus backoff (200 ms + 400 ms).

Use `syncModelPortSpec(port, spec)` after changing config without recreating ports.

### `ModelRequest` extensions

- `purpose`: `appraise` \| `classify` \| `safety` \| `reflection` \| `entity` \| `memory-write` \| `gallery-brief` (`object()`); `render` \| `offscreen` \| `autonomous` (`stream()`). The engine sets these; LLM ports may ignore them; the rule backend routes on them.
- `context`: structured turn inputs (`ModelCallContext`) for backends that avoid parsing prompts; **never** part of `recordingKey`.

Legacy ports without `purpose`/`context` remain valid.

## Prompt segments ([Section 17.5](../spec.md#175-prompt-segments))

Order: **static** (system, Anthropic cache bp 1) → **semiStatic** (system, bp 2) → **dynamic** (system, uncached) → **history** → **user**. OpenAI/Google rely on stable prefix ordering for automatic prefix caching; Anthropic uses `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }` on the first two system blocks.

## Anthropic base URL

`baseURL` (or `ANTHROPIC_BASE_URL`) may be written the way the official SDKs expect — an origin or gateway prefix **without** `/v1` (e.g. `http://localhost:8080/anthropic`). The AI SDK provider only appends `/messages`, so the engine normalises the URL through `normalizeAnthropicBaseURL`: a missing `/v1` segment is added, an already-versioned URL (`https://api.anthropic.com/v1`) is kept, and a pasted full endpoint (`…/v1/messages`) is trimmed back to `…/v1`.

## OpenAI-compatible gateways with split `reasoning` / `content`

Some local proxies return `message.reasoning` with empty `content`, or stream deltas only on `reasoning`. The engine wraps `fetch` via `createReasoningAwareFetch` / `chainReasoningFetch`:

- Injects `reasoning_effort: none` on outbound `/v1/chat/completions` JSON bodies when unset.
- Promotes JSON from `reasoning` into `content` when `content` is empty; strips reasoning fields before the AI SDK parses responses.

Defaults: `resolveOpenAICompatibleProviderOptions` sets `reasoning_effort: "none"` in `providerOptions.openaiCompatible` (SDK may not map it; fetch injection is authoritative).

## Recording

Key: `sha256(stableJson({ model: port.id, label, segments, schema JSON Schema fingerprint, tool names, maxOutputTokens, maxSteps, temperature, seed, recordingLocales }))`.

- `object`: stored value
- `stream`: slim `StreamPart[]` (`tool` + `final` only; cumulative `partial` chunks are not persisted). New JSONL rows may include `v: 2`. Replay re-yields stored tools, then one synthesized `partial` (final value) and `final`. Legacy recordings that still contain `partial` parts replay verbatim. Tool `execute` is not re-run on replay.
- Timeline `record` skips an append when lookup already returns the same canonical response. `compactRecordingsFile(path)` / lazy compaction on timeline open (record/live only) dedupe keys last-wins and strip legacy partials without changing lookup semantics.

Miss in replay: `AnimaeError("RECORDING_MISSING", key + label)`.

## Errors

| Code | When | `params` (wire-safe) |
|------|------|----------------------|
| `MODEL_CONFIG` | Invalid openai-compatible config (missing `baseURL`), invalid `models.s2.tiers`, unsupported embedding provider | — |
| `MODEL_TIMEOUT` | Abort / AI SDK timeout | `timeoutMs`, `seconds`, `phase`: `connect` \| `first_chunk` \| `idle` \| `total` |
| `MODEL_UNREACHABLE` | Connection refused, DNS, fetch failed | `host` (hostname only) |
| `MODEL_HTTP` | HTTP error from provider | `status`, optional `detail` (~200 chars, no secrets) |
| `MODEL_EMPTY` | No text / empty structured reply | — |
| `MODEL_OUTPUT_INVALID` | Schema validation failed after one repair pass **and** salvage found nothing usable | — |
| `RECORDING_MISSING` | Replay lookup miss | — |

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
