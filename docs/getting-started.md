# Getting started

Build a tiny playable world, validate it, then run with the TUI, plain REPL, or JSON-RPC sidecar.

## Prerequisites

- Bun (build + tests) and/or Node ≥ 24 (engine portability).
- API keys for live LLM calls, or `--model-mode replay` with a prior recording.

## 1. Create a data root

```bash
cd animae
bun run build
./dist/animae init ./tutorial --preset '@animae/preset-base'
```

This writes `animae.yaml`, `world/world.yaml`, a starter location, player skeleton, empty `policies/`, and `timelines/main/events.jsonl`.

## 2. Add an NPC and policy tweak

Copy the [validated tutorial tree](./examples/tutorial/) or add manually:

- `characters/guide/` — `card.md`, `traits.yaml`, `tracks.yaml`, `goals.yaml`, `secrets.yaml`, `relations.yaml`
- `world/locations/market.yaml` — second location
- `policies/tutorial.yaml` — small delta table overlay
- Update `animae.yaml` `policies:` list and `world/world.yaml` `start_location`

## 3. Configure models

In `animae.yaml` (or env vars referenced by `apiKeyEnv`):

```yaml
seed: 1
preset: "@animae/preset-base"
policies:
  - policies/tutorial.yaml
models:
  s1:
    provider: anthropic
    model: claude-haiku-4-5
    # apiKeyEnv: ANTHROPIC_API_KEY   # default
  s2:
    provider: anthropic
    model: claude-sonnet-4-5
```

Providers: `anthropic`, `openai`, `google`, `deepseek`, `ollama`, `openai-compatible`.

```yaml
models:
  s1:
    provider: ollama
    model: llama3.2
    baseURL: http://127.0.0.1:11434   # optional; strips trailing /api
  s2:
    provider: deepseek
    model: deepseek-chat
    options:
      thinking: { type: disabled }
# anthropic baseURL optional; else env ANTHROPIC_BASE_URL
```

Use `openai-compatible` with `baseURL` + `name` for OpenRouter, vLLM, LM Studio, etc. API keys are optional at config time; missing keys log once to `ModelWarningSink` (example-game: `~/.local/share/example-game/root/model-warnings.log`).

## 4. Validate

```bash
./dist/animae validate --root ./tutorial
./dist/animae validate --root ./tutorial --mods demo-pavilion
./dist/animae mods list --root ./tutorial
```

Exit code `0` prints `OK`. Failures list `file:path: message` lines.

Optional **content mods** (`mods/<id>/`, `animae.yaml` `mods:` list) overlay authored files; see [mods.md](./mods.md). Host games can override the enabled set via `createEngine({ mods, modBundles })` without editing the data root.

From repo source (without rebuilding):

```bash
cd animae/packages/cli
bun -e "import { runValidate } from './src/commands/validate.ts'; process.exit(await runValidate('../../docs/examples/tutorial'))"
```

## 5. Run interactively

**TUI (default):**

```bash
export ANTHROPIC_API_KEY=...
./dist/animae run --root ./tutorial
```

**Plain line mode** (colon commands: `:save`, `:load`, `:query player world/time`):

```bash
./dist/animae run --root ./tutorial --plain
```

**Record then replay** (deterministic re-run without API calls):

```bash
./dist/animae run --root ./tutorial --plain --model-mode record
./dist/animae run --root ./tutorial --plain --model-mode replay
```

Recordings live under `timelines/<branch>/recordings/`.

## 6. JSON-RPC sidecar

One JSON object per line on stdin; responses on stdout. Notifications: `turn.chunk`, `event` (after `subscribe`).

```bash
./dist/animae serve --stdio --root ./tutorial
```

Example session:

```json
{"jsonrpc":"2.0","id":1,"method":"info","params":{}}
{"jsonrpc":"2.0","id":2,"method":"scene.start","params":{"location":"home","participants":["player","guide"]}}
{"jsonrpc":"2.0","id":3,"method":"scene.turn","params":{"sceneId":"scn_0001","actor":"player","text":"Hello!","addressee":"guide"}}
```

See [rpc-reference.md](./rpc-reference.md) and [embedding.md](./embedding.md).

## 7. Inspect state

`validate` only checks authored data; **`inspect` / `run` / `serve` open a full engine** and require `models.s1` + `models.s2` in `animae.yaml` (or provider API keys in the environment). Uncomment the model block in §3 or copy from the tutorial tree after adding keys.

```bash
export ANTHROPIC_API_KEY=...   # or your provider env
./dist/animae inspect world/time --root ./tutorial --viewer debug
./dist/animae timeline list --root ./tutorial
```

## Next steps

- [authoring-guide.md](./authoring-guide.md) — all file formats
- [policy-reference.md](./policy-reference.md) — game rules in YAML
- [presets.md](./presets.md) — extend `@animae/preset-base` / DnD preset
