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
  models: { s1: modelPort, s2: modelPort },
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
  if (chunk.type === "text") process.stdout.write(chunk.text);
}

await engine.close();
```

Public surface: `api.ts` `Engine` interface (world, scene, timeline, entities, fields, director, query, …).

## Ports

| Port | Role |
|------|------|
| `ModelPort` | Structured LLM calls (appraise, render, reflect, generate) |
| `StoragePort` | Authored files + timeline JSONL |
| `EmbeddingPort` | Optional memory vector retrieval |

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

When bridging `engine.scene.turn` or `timeline.replay` to UI, use `applyTextTurnChunk` so transcript rows and stream callbacks stay **one row per utterance** (see [pipeline-and-events.md](./pipeline-and-events.md#turnchunk-streaming-render-step)). `@animae/host` exports `consumeTurnStream` with `onStreamStart` once per utterance, `onStreamDelta(requestId, fragment)` for true deltas, and `onStreamEnd` on `done` or abort.

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

Further reading: [rpc-reference.md](./rpc-reference.md), [modules/engine.md](./modules/engine.md).
