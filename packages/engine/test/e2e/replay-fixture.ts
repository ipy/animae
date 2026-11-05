import type { Engine } from "../../src/api.ts";
import type { StoragePort } from "../../src/ports.ts";
import type { PresetBundle } from "../../src/preset.ts";
import { openWorldEngine, patchWorldStartMinute, type WorldEngineHandle } from "./world-fixture.ts";
import {
  budgetPreset,
  collectTurn,
  lifecyclePreset,
  playTurn,
  streamingLifecycleLlm,
  type SessionHandle,
} from "./session-fixture.ts";
import { assertSnapshotEqualsReplay } from "./session-invariants.ts";

export { lifecyclePreset, streamingLifecycleLlm };

/** World + session preset for replay I2 exercises (reflection, budget triggers, schedule). */
export function replayRichPreset(): PresetBundle {
  return lifecyclePreset();
}

export async function openReplayRichEngine(
  opts: Parameters<typeof openWorldEngine>[0] = {},
): Promise<WorldEngineHandle> {
  const preset = opts.preset ?? replayRichPreset();
  const models = opts.models ?? streamingLifecycleLlm();
  return openWorldEngine({
    ...opts,
    preset,
    models,
    mode: opts.mode ?? "full",
    modelMode: opts.modelMode ?? "record",
    sessionId: opts.sessionId ?? "replay_rich",
    seed: async (s) => {
      await opts.seed?.(s);
      await patchWorldStartMinute(s, 470);
      await s.writeAtomic(
        "world/schedule.yaml",
        `- id: dawn_tick
  at: "day 1 08:00"
  emit:
    kind: world.var_set
    path: replay.sched
    value: 1
`,
      );
      await s.writeAtomic(
        "characters/npc2/relations.yaml",
        `- to: player
  kind: acquaintance
  tracks:
    affinity: 48
  share: "false"
`,
      );
      await s.writeAtomic(
        "characters/npc1/secrets.yaml",
        `- id: heirloom
  text: A hidden ring.
  tags: [heirloom]
  unlock: "false"
`,
      );
    },
  });
}

/** Turn through scene, world advance, entities, timeline ops, hot reload — then pin I2. */
export async function runRichReplaySession(h: WorldEngineHandle): Promise<void> {
  const { engine } = h;
  const scene1 = await engine.scene.start({
    location: "tavern",
    participants: ["player", "npc1", "npc2"],
    fields: ["salience"],
  });
  await collectTurn(engine.scene.turn({ sceneId: scene1, actor: "player", text: "Hi Aria!", addressee: "npc1" }));
  await playTurn(engine, scene1, "thank you for the warm welcome");
  await playTurn(engine, scene1, "tell me about the heirloom ring", { addressee: "npc1" });
  await engine.world.advance({ to: { day: 2, minute: 120 } });
  await engine.entities.setAlias({ entity: "npc1", nickname: "Ace", by: "player" });
  const guest = await engine.spawnEntity({
    kind: "character",
    card: {
      identity: { name: "Guest", summary: "Visitor", style_examples: [] },
      constraints: { motives: [], bottom_lines: [], taboos: [] },
      lod: "extra",
      tags: [],
    },
    persona: "A guest.",
    traits: { event_mult: {} },
    tracks: { self: {}, toward: {}, overrides: {} },
    goals: [],
    secrets: [],
    relations: [],
    knowledge: [],
  });
  await engine.entities.retire(guest.id);
  await engine.fields.grant({
    id: "replay-salience",
    holder: { kind: "character", ref: "npc1" },
    source: "author",
    level: "L0",
    priority: 0,
    stacking: "add",
    scope: { when: "true" },
    effects: { world_vars: { replay_field: 1 } },
  });
  await engine.scene.end(scene1);

  const scene2 = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
  await playTurn(engine, scene2, "follow-up chat");
  const slot = await engine.timeline.save("replay_mid");
  await playTurn(engine, scene2, "branch line after save");
  const eventsBeforeLoad = (await engine.timeline.events()).length;
  await engine.timeline.load(slot);
  expectEventsShorter(eventsBeforeLoad, (await engine.timeline.events()).length);
  await playTurn(engine, scene2, "after load");
  await engine.scene.end(scene2);
}

/** Timeline branch + hot reload after a baseline session (I2 on branched head). */
export async function runReplayTimelineBranchOps(h: WorldEngineHandle): Promise<void> {
  const { engine } = h;
  const forkAt = (await engine.timeline.events()).at(-1)!.id;
  await engine.timeline.rewind(forkAt);
  const worldYaml = (await h.storage.readText("world/world.yaml")) ?? "";
  await h.storage.writeAtomic("world/world.yaml", worldYaml.replace("language: en", "language: de"));
  const reload = await engine.reload();
  if (!reload.ok) {
    await h.storage.writeAtomic("world/world.yaml", worldYaml);
  }
}

function expectEventsShorter(before: number, after: number): void {
  if (after >= before) throw new Error(`expected fewer events after load: ${after} >= ${before}`);
}

export async function pinSnapshotReplay(
  engine: Engine,
  ctx: { storage: StoragePort; presets: PresetBundle[] },
): Promise<void> {
  await assertSnapshotEqualsReplay(engine, ctx);
}

export async function pinSnapshotReplaySession(h: SessionHandle, preset: PresetBundle): Promise<void> {
  await assertSnapshotEqualsReplay(h.engine, { storage: h.storage, presets: [preset] });
}

export async function pinSnapshotReplayWorld(h: WorldEngineHandle, preset: PresetBundle): Promise<void> {
  await assertSnapshotEqualsReplay(h.engine, { storage: h.storage, presets: [preset] });
}

