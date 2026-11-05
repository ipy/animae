import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import type { CreateEngineOptions, Engine } from "../../src/api.ts";
import { FsStorage } from "../../src/store/fs.ts";
import type { StoragePort } from "../../src/ports.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import type { PresetBundle } from "../../src/preset.ts";
import { e2ePreset, seedE2eAuthored } from "./fixture.ts";
import type { EngineEvent, TurnChunk } from "../../src/types.ts";

export function worldPreset(extra: Record<string, unknown>): PresetBundle {
  return {
    ...e2ePreset,
    policies: [...e2ePreset.policies, { name: "world-e2e.yaml", doc: extra }],
  };
}

export function worldScriptedModels(opts?: { renderText?: string; appraiseIntensity?: number }) {
  const renderText = opts?.renderText ?? "NPC line.";
  const intensity = opts?.appraiseIntensity ?? 0.55;
  const handler = (req: { label?: string; purpose?: string }) => {
    if (req.label === "appraise" || req.purpose === "appraise") {
      return {
        type: "chat",
        intensity,
        sincerity: 0.9,
        claims: [],
        search_terms: [],
        tags: ["social"],
        input_class: "normal",
      };
    }
    if (req.label === "reflect" || req.purpose === "reflect") {
      return { summaries: [], goal_changes: [], new_claims: [] };
    }
    if (req.label === "cg_brief" || req.purpose === "gallery-brief") {
      return {
        title: "Brief title",
        caption: "Brief cap.",
        prompt: "cozy tavern interior, warm light",
        characters: [{ name: "Player" }, { name: "Aria" }],
      };
    }
    if (req.label === "generate" || req.purpose === "entity") {
      return { name: "Generated Extra", persona: "Quiet and watchful." };
    }
    if (req.label === "offscreen" || req.purpose === "offscreen") {
      return { text: "Offscreen S2 sentence." };
    }
    return { text: renderText, cues: [], intent_realized: "talk" };
  };
  return {
    s1: createScriptedModel("world-e2e/s1", handler),
    s2: createScriptedModel("world-e2e/s2", handler),
  };
}

export interface WorldEngineHandle {
  engine: Engine;
  root: string;
  storage: StoragePort;
  reopen(opts?: Partial<CreateEngineOptions>): Promise<Engine>;
  dispose(): Promise<void>;
}

export interface OpenWorldEngineOptions extends Partial<Omit<CreateEngineOptions, "root" | "seed">> {
  preset?: PresetBundle;
  /** Extra lines appended to animae.yaml after seed (preset line preserved). */
  yamlExtra?: string;
  /** Called after seedE2eAuthored to write schedule, anchors, mods, etc. */
  seed?: (storage: StoragePort) => Promise<void>;
  /** Register rules/hooks after the engine opens (schedule item rules, daily hooks). */
  onOpen?: (engine: Engine) => void | Promise<void>;
}

export async function patchWorldStartMinute(storage: StoragePort, minute: number): Promise<void> {
  const world = (await storage.readText("world/world.yaml")) ?? "";
  await storage.writeAtomic(
    "world/world.yaml",
    world.replace(/minute: \d+/, `minute: ${minute}`),
  );
}

export async function openWorldEngine(opts: OpenWorldEngineOptions = {}): Promise<WorldEngineHandle> {
  const root = await mkdtemp(join(tmpdir(), "animae-world-e2e-"));
  const storage = FsStorage(root);
  await seedE2eAuthored(storage);
  if (opts.seed) await opts.seed(storage);
  if (opts.yamlExtra) {
    const base = (await storage.readText("animae.yaml")) ?? "";
    await storage.writeAtomic("animae.yaml", `${base.replace(/\n?$/, "\n")}${opts.yamlExtra}\n`);
  }
  const preset = opts.preset ?? e2ePreset;
  const models = opts.models ?? worldScriptedModels();
  const open = async (o: Partial<CreateEngineOptions> = {}) => {
    const engine = await createEngine({
      root,
      ports: { storage: FsStorage(root), ...opts.ports, ...o.ports },
      presets: [preset],
      models,
      seed: 42,
      sessionId: opts.sessionId ?? "world_e2e",
      modelMode: opts.modelMode ?? "record",
      mode: opts.mode,
      modBundles: opts.modBundles,
      mods: opts.mods,
      ...o,
    });
    if (opts.onOpen) await opts.onOpen(engine);
    return engine;
  };
  const opened: Engine[] = [await open()];
  return {
    engine: opened[0]!,
    root,
    storage,
    reopen: async (o) => {
      const e = await open(o);
      opened.push(e);
      return e;
    },
    dispose: async () => {
      for (const e of opened) await e.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function drainTurn(iter: AsyncIterable<TurnChunk>): Promise<{ chunks: TurnChunk[]; eventIds: string[] }> {
  const chunks: TurnChunk[] = [];
  let eventIds: string[] = [];
  for await (const c of iter) {
    chunks.push(c);
    if (c.type === "done") eventIds = c.events ?? [];
  }
  return { chunks, eventIds };
}

export async function eventsByKind(engine: Engine, ...kinds: string[]): Promise<EngineEvent[]> {
  const all = await engine.timeline.events(kinds.length ? { kinds } : undefined);
  if (kinds.length === 0) return all;
  return all.filter((e) => kinds.includes(e.kind));
}

const ACTIVE_GALLERY_JOB = new Set(["queued", "briefing", "rendering", "storing"]);

export async function waitGalleryJob(
  engine: Engine,
  jobId: string,
  maxSpins = 3000,
): Promise<NonNullable<ReturnType<Engine["gallery"]["jobs"]>[number]> | undefined> {
  for (let i = 0; i < maxSpins; i++) {
    const j = engine.gallery.jobs().find((x) => x.id === jobId);
    if (j && !ACTIVE_GALLERY_JOB.has(j.state)) return j;
    await new Promise<void>((r) => setImmediate(r));
  }
  return engine.gallery.jobs().find((x) => x.id === jobId);
}
