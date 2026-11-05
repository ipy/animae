# Model call log

In-memory ring buffer of every `ModelPort` `object` / `stream` invocation (LLM ports and the rule `ModelPort` when wrapped), after record/replay wrapping, for debugging prompts and raw model output without touching disk unless explicitly exported. Rule-backend calls have no network traffic but still appear when logging is enabled.

## Enabling

Pass `modelCallLog` to `createEngine`:

```typescript
const engine = await createEngine({
  root: dataRoot,
  models: { s1, s2 },
  modelCallLog: true, // default capacity 200, max ~48k chars per string field
});
```

Or supply options / a shared instance:

```typescript
const log = createModelCallLog({ capacity: 400 });
await createEngine({ root, models, modelCallLog: log });
engine.modelCallLog === log; // same reader on `Engine`
```

Wrapping order: `withRecording` (inner) then `withModelCallLog` (outer), so replay and live calls both appear in the log.

## API (`@animae/engine`)

| Export | Role |
|--------|------|
| `createModelCallLog(opts?)` | Ring buffer with `list`, `get`, `clear`, `toJsonl` |
| `withModelCallLog(port, { slot, log })` | Wraps a port (`slot`: `s1`, `s2`, or tier id for S2) |
| `writeModelCallLogJsonl(log, dataRoot)` | Writes `llm-log/<timestamp>.jsonl` under the data root |
| `redactSecrets(text)` | Strips API-key-like substrings |

Each entry includes: monotonic `seq`, opaque `id`, wall `startedAt`, slot (`s1` / `s2`), optional S2 `tier`, `label`, `modelId`, prompt `segments` (roles `static` / `semiStatic` / `dynamic` / `history` / `user`), optional JSON-schema fingerprint, tool names, request `params` (`maxOutputTokens`, `maxSteps`, `temperature`, `seed`, `recordingLocales`), concatenated raw `response.raw` (or structured `final`), `toolCalls`, `usage`, `timing` (`firstChunkMs`, `totalMs`), optional `turnId` / `requestId`, and `status` (`ok` / `error` / `aborted`).

Oversized strings are truncated per segment with `truncated: true` (default ~48k chars total budget per entry). Headers, env vars, and API keys are never stored raw — see redaction below.

Hosts declare **`ModelPort.tags`** (capability labels); those tags are also visible to CEL as `model.tags` with `model.kind` during the same call (see [cel-reference.md](./cel-reference.md)). `ModelRequest.context` is never stored in the log or recording keys.

## Web protocol

Clients (controller or spectator, after `hello`):

- `{ v:1, type:"llm_log", id, since?, limit?, label?, slot?, errorsOnly? }` → `result` with `{ enabled, entries, newestSeq }` (at most 50 entries per response).
- `{ v:1, type:"llm_log_clear", id }` → clears the in-memory buffer.

Same auth, rate limits, and message size caps as other read-only queries.

## Host / TUI

`:llmlog` — last 10 calls; `:llmlog <seq>` — prompt + response for one entry; `:llmlog dump` — JSONL under `<data root>/llm-log/`.

## Redaction rules

Applied to every stored segment and error message:

- OpenAI-style `sk-…` tokens
- `Bearer …` authorization fragments
- `x-api-key:` / `authorization:` header-like lines

If redaction cannot guarantee safety, prefer omission over leaking secrets.
