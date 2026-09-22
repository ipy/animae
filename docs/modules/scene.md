# Scene service (`src/scene/`)

## Purpose

Serial scene lifecycle: start → turns → end ([invariants](../spec.md#3-engine-invariants), [multi-character orchestration](../spec.md#14-multi-character-orchestration)).

## Public API

```ts
createSceneService(k: Kernel, hooks: HookRegistry, opts?: { afterTurn?: () => Promise<void> }): {
  start(s: { location: string; participants: string[]; fields?: string[] }): Promise<SceneId>;
  turn(t: { sceneId; actor; text; addressee?; choiceId? }): AsyncIterable<TurnChunk>;
  end(sceneId: SceneId): Promise<SceneReport>;
  active(): ActiveScene | null; // { id, location, participants, turn } of the open scene, else null
}
```

Re-exported from `src/scene/index.ts`; exposed on `Engine.scene`.

## Behaviour

- **start**: validate catalog, `world.move` player, catch-up participants + location, `memory.flushDeferred`, `scene.started`, director `scene_start`, `rules.custom` stage `scene_start`.
- **turn**: single flight (`TURN_IN_FLIGHT`); speaker/addressee from `policy.scene.turnTaking` (default addressed); delegates to `runTurn`; optional `afterTurn` (engine uses this for hot reload); NPC **autonomous** exchanges per policy when router allows.
- **end**: min duration via `world.advance`, `fields.onSceneEnd`, capture participants, `scene.ended`, reflection (`defer` per router; passes captured participants so S2 runs after `state.scene` is cleared), `memory.propagateTick`, `maybeSnapshot("scene_end")`, `SceneReport`. Deferred reflections flush at the next `scene.start` (`flushDeferred`) in FIFO order.

- **active**: reads the live projection (`state.scene`), so it is always correct after `timeline.load` / `rewind` / `switch` / `import`, which can replace the open scene (or remove it). Hosts must re-sync from it rather than caching the id returned by `start`; `end` and `turn` throw `SCENE_INVALID` for any other id.

## Edge cases

- Only one active scene; ended scenes reject turns.
- Autonomous turns use empty actor text; each yields its own `done` chunk.
