import { expect } from "bun:test";
import type { Engine } from "../../src/api.ts";
import type { StoragePort } from "../../src/ports.ts";
import { loadAuthored } from "../../src/authored/load.ts";
import { loadPolicy } from "../../src/policy/load.ts";
import { createPresetRegistry } from "../../src/policy/registry.ts";
import type { PresetBundle } from "../../src/preset.ts";
import { rebuildState, SNAPSHOT_EVERY } from "../../src/timeline/snapshots.ts";
import { readEventsFile } from "../../src/timeline/event-log.ts";
import type { EngineEvent } from "../../src/types.ts";

/** Assert kinds appear in log order (each at or after the previous index). */
export function expectKindsInOrder(events: EngineEvent[], kinds: string[]): void {
  let from = 0;
  for (const k of kinds) {
    const idx = events.findIndex((e, i) => i >= from && e.kind === k);
    expect(idx).toBeGreaterThanOrEqual(0);
    from = idx + 1;
  }
}

export function decayDeltaEvents(events: EngineEvent[]): EngineEvent[] {
  return events.filter((e) => e.kind === "track.delta" && (e as { reason?: string }).reason === "decay");
}

/** Authored schedule item id on a persisted `schedule.fired` / long-event event. */
export function scheduleItemId(e: EngineEvent): string {
  const m = /^schedule:(.+)$/.exec(e.source ?? "");
  if (m) return m[1]!;
  const id = (e as { id?: string }).id ?? "";
  return /^evt_/.test(id) ? "" : id;
}

export function scheduleFiredIds(events: EngineEvent[]): string[] {
  return events.filter((e) => e.kind === "schedule.fired").map(scheduleItemId).filter(Boolean);
}

export async function resolveAuthoredPolicy(storage: StoragePort, presets: PresetBundle[]) {
  const registry = createPresetRegistry(presets);
  const authored = await loadAuthored(storage, { presets: registry });
  const known = new Set<string>();
  for (const b of presets) {
    b.rules?.({ register: (n) => known.add(n) });
  }
  const policyResult = await loadPolicy(storage, authored.config, registry, {
    knownRuleFns: known,
    authoredFields: Object.fromEntries(Object.entries(authored.fields).map(([id, f]) => [id, { level: f.level }])),
  });
  return { authored, policy: policyResult.policy };
}

/** Live engine state equals full replay and (when present) latest snapshot + tail replay. */
export async function assertStateReplayEquivalent(
  engine: Engine,
  storage: StoragePort,
  branch: string,
  presets: PresetBundle[],
): Promise<void> {
  const live = engine.query("debug", "state") as Awaited<ReturnType<typeof rebuildState>>;
  expect(live).toBeDefined();
  const { authored, policy } = await resolveAuthoredPolicy(storage, presets);
  const { events } = await readEventsFile(storage, branch);
  const full = await rebuildState(authored, policy, events);
  expect(full).toEqual(live);
}

export { SNAPSHOT_EVERY };
