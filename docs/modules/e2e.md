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

## Host-level e2e (outside this package)

Hosts often add integration tests on a full authored data root (decay, schedule, anchors on `world.advance`, long `record` → copy → `replay` I6 checks). Keep those tests in the host repository; engine e2e stays fixture-based under `test/e2e/`.
