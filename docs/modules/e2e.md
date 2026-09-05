# E2E tests (`test/e2e/`)

## Purpose

Integration tests for `createEngine` on real `FsStorage` temp dirs with `ScriptedModel` ports.

## Fixture

`test/e2e/fixture.ts`: `seedE2eAuthored`, `e2ePreset` (embedded policy bundle id `e2e`).

## Coverage

- Multi-turn scene (streaming chunks, `input.received`, utterance, cues).
- Timeline save/load/rewind/diff.
- Record → replay mode byte-stable event log + replay chunks (I6).
- Hot reload success/failure.
- Lock release + reopen.
- 1000× `world.set` sanity timing.

Run: `cd animae/packages/engine && bun test test/e2e`.

## Lilium real data (`games/lilium/test/e2e/real-data.test.ts`)

- Decay + schedule/daily on `:endday` advances; anchors (`anvil-ultimatum`, `hansheng-rescue`) fire on `world.advance` before the next scene.
- **I6**: long scripted session in `record` mode, filesystem copy of the data root, `replay` mode asserts identical event logs (ids/payloads/order), `rebuildState` equality, and `timeline.replay` chunks vs live `TurnChunk`s.
