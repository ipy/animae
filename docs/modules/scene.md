# Scene service (`src/scene/`)

## Purpose

Serial scene lifecycle: start → turns → end (spec §3, §14).

## Public API

```ts
createSceneService(k: Kernel, hooks: HookRegistry, opts?: { afterTurn?: () => Promise<void> }): {
  start(s: { location: string; participants: string[]; fields?: string[] }): Promise<SceneId>;
  turn(t: { sceneId; actor; text; addressee?; choiceId? }): AsyncIterable<TurnChunk>;
  end(sceneId: SceneId): Promise<SceneReport>;
}
```

Re-exported from `src/scene/index.ts`; exposed on `Engine.scene`.

## Behaviour

- **start**: validate catalog, `world.move` player, catch-up participants + location, `memory.flushDeferred`, `scene.started`, director `scene_start`, `rules.custom` stage `scene_start`.
- **turn**: single flight (`TURN_IN_FLIGHT`); speaker/addressee from `policy.scene.turnTaking` (default addressed); delegates to `runTurn`; optional `afterTurn` (engine uses this for hot reload); NPC **autonomous** exchanges per policy when router allows.
- **end**: min duration via `world.advance`, `fields.onSceneEnd`, capture participants, `scene.ended`, reflection (`defer` per router; passes captured participants so S2 runs after `state.scene` is cleared), `memory.propagateTick`, `maybeSnapshot("scene_end")`, `SceneReport`. Deferred reflections flush at the next `scene.start` (`flushDeferred`) in FIFO order.

## Edge cases

- Only one active scene; ended scenes reject turns.
- Autonomous turns use empty actor text; each yields its own `done` chunk.
