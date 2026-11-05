# Embedding Animae

Use `@animae/engine` as a library or drive it from another process via the JSON-RPC sidecar.

## `createEngine`

```typescript
import { createEngine, FsStorage } from "@animae/engine";
import { preset as presetBase } from "@animae/preset-base";

const engine = await createEngine({
  root: "/path/to/data",
  presets: [presetBase],
  mods: ["my-content-pack"], // optional; overrides animae.yaml `mods:`
  modBundles: [embeddedModFromGenScript], // optional embedded ModBundle (+ setup())
  modelMode: "record", // default if omitted in many CLI paths
  seed: 42,
  // models optional: omit both roles → rule backend only (zero tokens)
  models: { s1: modelPort, s2: modelPort }, // or s2: { default, tiers: [{ id, port }], routing }
  mode: "full", // optional override of animae.yaml: full | judge-only | narrate-only | rule
  ports: {
    storage: FsStorage("/path/to/data"), // optional; defaults to root
    embedding: embeddingPort,            // optional vector search
  },
  sessionId: "my-session",             // tests: fix for determinism
});

await engine.scene.start({ location: "home", participants: ["player", "npc"] });
for await (const chunk of engine.scene.turn({
  sceneId: "scn_0001",
  actor: "player",
  text: "Hello",
  addressee: "npc",
})) {
  if (chunk.type === "narration") process.stdout.write(`[${chunk.style ?? "normal"}] ${chunk.text}`);
  else if (chunk.type === "text") process.stdout.write(chunk.text);
  else if (chunk.type === "reset") { /* discard buffered output since the player's line */ }
}

await engine.close();
```

Public surface: `api.ts` `Engine` interface (world, scene, timeline, entities, fields, director, `runtime`, query, …).

### Runtime mode (library)

```typescript
const before = engine.runtime.mode(); // { appraise: "llm"|"rule", render: "llm"|"rule", s2Tier? }
const { after, pending } = await engine.runtime.setMode("rule", { reason: "api", trigger: "settings-ui" });
// pending === true when switchAt is turn_boundary and a turn is streaming
engine.runtime.models(); // { s1, s2, s1Llm, s2Tiers, s2Default?, s2Escalate? } — safe for UI labels
```

Presets: `full` (LLM/LLM), `judge-only` (LLM/rule), `narrate-only` (rule/LLM), `rule` (rule/rule). See [spec Appendix B](./spec.md#appendix-b-runtime-modes-and-switching).

### Zero-token setup

```typescript
import { createEngine } from "@animae/engine";
import { preset as presetRule } from "@animae/preset-rule";

const engine = await createEngine({
  root: "/path/to/data",
  presets: [presetRule],
  mode: "rule",
  // no models — both S1 and S2 roles are served by createRuleModelPort internally
});
```

Author rule-backend copy in policy (`render.layers`, `appraise.patterns`, `choices.rules`, …) or extend `@animae/preset-base` / `@animae/preset-rule`. Validate with `animae validate --mode rule`.

## Ports

| Port | Role |
|------|------|
| `ModelPort` | S1 structured calls (`object`) and S2 streaming (`stream`); id `rule` for the built-in rule backend (`createRuleModelPort`) |
| `StoragePort` | Authored files + timeline JSONL |
| `EmbeddingPort` | Optional memory vector retrieval |
| `ImagePort` | Optional CG gallery image generation ([gallery.md](./gallery.md)) |

Build models from config:

```typescript
import { createModelsFromConfig } from "@animae/engine";
const models = createModelsFromConfig(animaeYaml.models, process.env);
```

Wrap with record/replay:

```typescript
import { withRecording } from "@animae/engine";
const s1 = withRecording(liveS1, { mode: "record", dir: recordingsDir });
```

Modes: `live` | `record` | `replay`. Replay reads prior recordings keyed by call site; **same seed + branch + recordings → byte-identical event logs** (invariant I6).

### Model call log (debug)

Enable an in-memory ring buffer of every `ModelPort` `object` / `stream` call (after record/replay wrapping):

```typescript
const engine = await createEngine({
  root,
  models: { s1, s2 },
  modelCallLog: true, // or pass createModelCallLog({ capacity: 400 })
});
// engine.modelCallLog?.list(), .get(seq), .clear(), writeModelCallLogJsonl(log, root)
```

Wrapping order: `withRecording` (inner) then `withModelCallLog` (outer). Full API, redaction rules, Web `llm_log` messages, and TUI `:llmlog`: [model-call-log.md](./model-call-log.md).

### Turn stream consumption

When bridging `engine.scene.turn` or `timeline.replay` to UI:

- **`text`:** `createUtteranceStreamState`, `applyTextTurnChunk`, `closeUtteranceStream` — one row per utterance.
- **`narration`:** `createParagraphStreamState`, `applyNarrationTurnChunk`, `closeParagraphStream` — one row per paragraph; `style` is `normal` or `scene_break`.
- **`reset`:** drop all streamed `text` / `narration` / `cue` / `choices` since the actor's echoed line (`isActorEcho` helps identify the line to keep).

`@animae/host` `consumeTurnStream` implements the full contract (including Web `stream` phases). See [spec Section 20.1](./spec.md#201-typescript-api) and [pipeline-and-events.md](./pipeline-and-events.md) (`TurnChunk` streaming section).

## Determinism checklist

- Set explicit `seed` and `sessionId` in tests.
- No `Math.random` / `Date.now()` in rules (RNG via `timeline.rng(key)` only).
- Use `modelMode: "replay"` or `ScriptedModel` in tests.
- Scene-end async jobs (reflection, offscreen) are awaited before `scene.end` resolves.

## Hot reload

```typescript
const result = await engine.reload();
// re-reads authored files + policies; emits config.* events
```

Compare `authored.hash` across reloads in your tooling. Mod directory changes are watched the same way as base authored files.

## Content mods (spec-compat)

Not in the v1.0 product spec text; shipped as an **additive** engine feature ([Contract changelog](./architecture.md#9-contract-changelog-append-only), [mods.md](./mods.md)):

- `animae.yaml` field `mods: string[]` (default `[]`).
- `CreateEngineOptions.mods` / `modBundles`, `Engine.mods()` with `drift` when timeline mod record differs.
- Filesystem mods are data-only; `ModBundle.setup()` is the only v1 code path and must be host-registered.
- Enabled mod `{ id, version, contentHash }` is part of authored hash and `config.reloaded.mods`.

## Sidecar from another language

Spawn the CLI with stdio JSON-RPC:

```bash
animae serve --stdio --root /path/to/data --model-mode live
```

### Python example

```python
import json
import subprocess

proc = subprocess.Popen(
    ["./animae", "serve", "--stdio", "--root", "./my-world"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True,
    bufsize=1,
)

def call(method, params, req_id):
    msg = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
    proc.stdin.write(json.dumps(msg) + "\n")
    proc.stdin.flush()
    while True:
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError("EOF")
        obj = json.loads(line)
        if "id" in obj and obj["id"] == req_id:
            if "error" in obj:
                raise RuntimeError(obj["error"])
            return obj["result"]
        # handle notifications: turn.chunk, event

info = call("info", {}, 1)
sid = call("scene.start", {"location": "home", "participants": ["player", "guide"]}, 2)
# sceneId in side effects / next query
call("scene.turn", {
    "sceneId": sid if isinstance(sid, str) else "scn_0001",
    "actor": "player",
    "text": "Hello",
    "addressee": "guide",
}, 3)
```

Subscribe before turns if you need streaming on stdout while the request is in flight.

## Host integration pattern

A typical host wraps `createEngine({ root, presets, modBundles, … })`, then calls `runTui` from `@animae/tui`, the CLI plain mode, or `animae serve --stdio`. Register presets, optional `ModBundle.setup()` hooks, and custom TUI actions in one bootstrap module.

### CG gallery in hosts

Wire `ImagePort` on `createEngine({ ports: { image } })`, then expose the collection through `@animae/host`:

```typescript
import { SessionHost } from "@animae/host";
import { createWebServer } from "@animae/web";

const host = new SessionHost({
  engine,
  openFile: (path) => { /* OS viewer */ },
  galleryNotices: {
    maskTitle: (item) => item.rating !== "general",
    toasts: true,
  },
});

createWebServer({
  host,
  port: 8787,
  assets: myAssets,
  gallery: {
    defaultRating: "general",
    galleryImagePolicy: (item) =>
      item.rating === "general" ? { cache: "immutable" } : { cache: "no-store" },
  },
  hooks: {
    // Optional: Settings UI "Test" without saving config (controller only)
    async imagesProbe(draft) {
      return { ok: true, lines: ["stub probe"] };
    },
  },
});
```

Web clients send `{ type: "images_probe", id, draft?: object }`; the room calls `hooks.imagesProbe(draft)` and returns a host-defined result (for example a connectivity test against unsaved image settings). Without the hook, the server answers `UNSUPPORTED`.

TUI: pass `galleryPresentation` and `openFile` on `runTui`. Headless: `animae gallery list --root ./data` with optional `--image-command ./scripts/fake-gen.sh`.

Further reading: [gallery.md](./gallery.md), [rpc-reference.md](./rpc-reference.md), [modules/engine.md](./modules/engine.md).
