# Getting started

Build a tiny playable world, validate it, then run with the TUI, plain REPL, or JSON-RPC sidecar.

## Prerequisites

- Bun (build + tests) and/or Node ≥ 24 (engine portability).
- For **LLM play:** API keys (or local Ollama). For **offline play:** no keys — use `--mode rule` and a rule-ready preset (see [Run without an LLM](#run-without-an-llm)).
- Optional: `--model-mode replay` with a prior recording for deterministic re-runs of recorded LLM sessions.

## 1. Create a data root

```bash
# from the repository root
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

Use `openai-compatible` with `baseURL` + `name` for OpenRouter, vLLM, LM Studio, etc. API keys are optional at config time; missing keys log once via `ModelWarningSink` (hosts may append warnings to a file under `$XDG_DATA_HOME/<app>/`).

## 4. Validate

```bash
./dist/animae validate --root ./tutorial
./dist/animae validate --root ./tutorial --mode rule   # rule-backend playability (layers, string keys, …)
./dist/animae validate --root ./tutorial --mods demo-pavilion
./dist/animae mods list --root ./tutorial
```

Exit code `0` prints `OK`. Failures list `file:path: message` lines. With `--mode rule`, `judge-only`, or `narrate-only`, validation also checks that authored rule content can serve that mode (catch-all render line, defined `$t:` keys, warnings for features the rule backend would skip).

Optional **CG gallery**: add a `gallery:` block to `animae.yaml` (preset entries, ratings) and wire an `ImagePort` when you want on-demand captures or generated preset art. Shipped images under `gallery/art/` validate with the rest of the data root. See [gallery.md](./gallery.md).

Optional **content mods** (`mods/<id>/`, `animae.yaml` `mods:` list) overlay authored files; see [mods.md](./mods.md). A host application can override the enabled set via `createEngine({ mods, modBundles })` without editing the data root.

From repo source (without rebuilding):

```bash
cd packages/cli
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

**Runtime mode** (switch LLM vs rule per role without restarting):

```bash
./dist/animae run --root ./tutorial --mode rule          # both roles on rules
./dist/animae run --root ./tutorial --mode judge-only    # S1 LLM, S2 rule
./dist/animae run --root ./tutorial --mode narrate-only  # S1 rule, S2 LLM
```

In the TUI, **F6** opens the mode panel; the footer shows `[RULE]` or `[S1:LLM S2:<tier>]`. Plain mode supports `:mode rule`, `:mode s2 llm|rule|<tier>`, `:mode status`. See [tui-guide.md](./tui-guide.md) and [spec Section 20.3](./spec.md#203-cli).

## Run without an LLM

Fastest path: rule-first preset, no `models` block.

```bash
./dist/animae init ./offline --preset '@animae/preset-rule'
# Add at least one NPC under characters/ (copy from docs/examples/tutorial/ if you like)
./dist/animae validate --root ./offline --mode rule
./dist/animae run --root ./offline --mode rule
```

`@animae/preset-base` already ships appraisal patterns and render layers; `@animae/preset-rule` enables quick-reply choices and extra command keywords for keyboard-first play. Typing still works via `appraise.patterns` / `appraise.commands`; choices are the main input when `choices.enabled: true`.

You can also omit `models` in an existing data root and set `mode: rule` in `animae.yaml`, or pass `--mode rule` on `run` / `serve` / `inspect`.

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

`validate` only checks authored data; **`inspect` / `run` / `serve` open a full engine**. Models are optional: with `--mode rule` (or no models configured and default rule mode), no API keys are needed. For LLM modes, uncomment the model block in [Section 3](#3-configure-models) and set provider env vars.

```bash
./dist/animae inspect world/time --root ./tutorial --mode rule --viewer debug
./dist/animae inspect events --root ./tutorial --mode rule --kind narration
./dist/animae timeline list --root ./tutorial
```

`--kind` filters the `events` query path (for example `narration`, `route.decided`, `runtime.mode_changed`).

## Next steps

- [authoring-guide.md](./authoring-guide.md) — all file formats
- [policy-reference.md](./policy-reference.md) — game rules in YAML
- [presets.md](./presets.md) — extend `@animae/preset-base` / DnD preset
