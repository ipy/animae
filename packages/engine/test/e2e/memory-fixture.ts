import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import type { CreateEngineOptions, Engine } from "../../src/api.ts";
import type { RetrievalLogHit } from "../../src/events.ts";
import type { EngineEvent } from "../../src/types.ts";
import type { EmbeddingPort } from "../../src/ports.ts";
import type { PresetBundle } from "../../src/preset.ts";
import { FsStorage } from "../../src/store/fs.ts";
import type { StoragePort } from "../../src/ports.ts";
import { artifactPath } from "../../src/timeline/paths.ts";
import { e2ePreset, seedE2eAuthored } from "./fixture.ts";
import { seedSessionAuthored } from "./session-fixture.ts";
import { scriptedLlm, type ScriptedLlm, type ScriptedLlmOptions } from "../helpers/llm-scripts.ts";

type UtteranceEvent = EngineEvent & { retrieval?: RetrievalLogHit[] };

/** Non-empty `retrieval` hits on an `utterance` event (replay-safe log shape). */
export function utteranceRetrievalHits(e: EngineEvent): RetrievalLogHit[] {
  if (e.kind !== "utterance") return [];
  const retrieval = (e as UtteranceEvent).retrieval;
  return Array.isArray(retrieval) ? retrieval : [];
}

export function isUtteranceWithRetrieval(e: EngineEvent): e is UtteranceEvent & { retrieval: RetrievalLogHit[] } {
  return utteranceRetrievalHits(e).length > 0;
}

export function memoryStoryPreset(extra?: Record<string, unknown>): PresetBundle {
  return {
    ...e2ePreset,
    policies: [
      ...e2ePreset.policies,
      {
        name: "memory-story.yaml",
        doc: {
          reflection: { enabled: true, accept: "true" },
          memory: {
            write: { episodic: true, minIntensity: 0.15, maxChars: 400 },
            forgetting: { enabled: false, tau: 30, threshold: 0.2 },
            distortion: { enabled: true, p: 1, maxImportance: 1, kinds: ["intensify"] },
            propagation: { enabled: false, onTick: "day", distortionPerHop: 1 },
            weights: { vector: 0, term: 0.5, recency: 0.2, importance: 0.2, salience: 0.1 },
            k: 8,
          },
          router: {
            budget: { syncCallsPerTurn: 4, s2PerTurn: 3, s2Ratio: 1, s2ReservedForAnchors: 0, maxOutputTokens: { s1: 400, s2: 800 } },
          },
          ...extra,
        },
      },
    ],
  };
}

export function memoryPropagationPreset(onTick: "day" | "scene_end"): PresetBundle {
  return memoryStoryPreset({
    reflection: { enabled: false, accept: "true" },
    memory: {
      write: { episodic: true, minIntensity: 0.1, maxChars: 200 },
      forgetting: { enabled: false, tau: 30, threshold: 0.2 },
      distortion: { enabled: false, p: 0, maxImportance: 1, kinds: [] },
      propagation: { enabled: true, onTick, distortionPerHop: 1 },
    },
  });
}

export function memoryKnowledgePreset(vectorWeight: number): PresetBundle {
  return memoryStoryPreset({
    reflection: { enabled: false, accept: "true" },
    memory: {
      write: { episodic: false, minIntensity: 0.1, maxChars: 200 },
      forgetting: { enabled: false, tau: 30, threshold: 0.2 },
      distortion: { enabled: false, p: 0, maxImportance: 1, kinds: [] },
      propagation: { enabled: false, onTick: "day", distortionPerHop: 1 },
      weights: { vector: vectorWeight, term: 0.5, recency: 0.2, importance: 0.2, salience: 0.1 },
      indexMax: 4,
      k: 5,
    },
  });
}

/** Deterministic in-process embeddings (no network). */
export function deterministicEmbeddingPort(): EmbeddingPort {
  return {
    embed: async (texts: string[]) =>
      texts.map((t) => {
        if (t.includes("VECTOR_FAVOR_A")) return new Float32Array([1, 0]);
        if (t.includes("VECTOR_FAVOR_B")) return new Float32Array([0, 1]);
        if (t.includes("VECTOR_FAVOR_A") && !t.includes("VECTOR_FAVOR_B")) return new Float32Array([1, 0]);
        if (t.includes("VECTOR_FAVOR_B") && !t.includes("VECTOR_FAVOR_A")) return new Float32Array([0, 1]);
        if (t.includes("alpha") && t.includes("beta")) return new Float32Array([1, 0]);
        return new Float32Array([0.5, 0.5]);
      }),
  };
}

export interface MemoryEngineHandle {
  engine: Engine;
  root: string;
  storage: StoragePort;
  reopen(opts?: Partial<CreateEngineOptions>): Promise<Engine>;
  dispose(): Promise<void>;
}

export async function openMemoryEngine(
  opts: Partial<CreateEngineOptions> & { preset?: PresetBundle; seedExtra?: (s: StoragePort) => Promise<void> } = {},
): Promise<MemoryEngineHandle> {
  const root = await mkdtemp(join(tmpdir(), "animae-memory-e2e-"));
  const storage = FsStorage(root);
  await seedSessionAuthored(storage);
  if (opts.seedExtra) await opts.seedExtra(storage);
  const { preset = memoryStoryPreset(), seedExtra: _s, ...rest } = opts;
  const presets = [preset];
  const open = (o: Partial<CreateEngineOptions> = {}) =>
    createEngine({
      root,
      ports: { storage: FsStorage(root), ...rest.ports },
      presets,
      seed: 42,
      ...rest,
      ...o,
    });
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

export async function seedShareableNpc1Memory(storage: StoragePort, id: string, text: string): Promise<void> {
  await storage.writeAtomic(
    artifactPath("main", "npc1/memory.jsonl"),
    `${JSON.stringify({
      id,
      t: { day: 1, minute: 400 },
      kind: "episodic",
      text,
      tags: ["shareable"],
      shareable: true,
      claims: [],
      importance: 0.7,
      valence: 0.1,
      branch: "main",
    })}\n`,
  );
}

export async function seedPrivateNpc2Memory(storage: StoragePort): Promise<void> {
  await storage.writeAtomic(
    artifactPath("main", "npc2/memory.jsonl"),
    `${JSON.stringify({
      id: "mem_npc2_private",
      t: { day: 1, minute: 400 },
      kind: "episodic",
      text: "NPC2_PRIVATE_CODeword only Ben knows.",
      tags: ["private"],
      shareable: false,
      claims: [],
      importance: 0.9,
      valence: 0,
      branch: "main",
    })}\n`,
  );
}

export async function seedKnowledgeDocs(storage: StoragePort): Promise<void> {
  await storage.writeAtomic(
    "world/knowledge/always-lore.md",
    `---
name: always-lore
description: Static tavern lore
scope: world
inject: always
tags: [tavern]
priority: 10
shareable: false
---
ALWAYS_LORE_BODY for the tavern.
`,
  );
  await storage.writeAtomic(
    "world/knowledge/when-confession.md",
    `---
name: when-confession
description: Confession context
scope: world
inject: when
when: "event.type == 'care'"
tags: []
priority: 20
shareable: false
---
WHEN_CARE_BODY appears on care events.
`,
  );
  await storage.writeAtomic(
    "world/knowledge/on-demand-index.md",
    `---
name: on-demand-index
description: Indexed for search
scope: world
inject: on-demand
tags: [indexed]
priority: 30
shareable: false
---
ON_DEMAND_INDEX_BODY with indexed keyword.
`,
  );
}

export async function seedVectorKnowledgePair(storage: StoragePort): Promise<void> {
  await storage.writeAtomic(
    "world/knowledge/vector-a.md",
    `---
name: vector-a
description: doc a
scope: world
inject: on-demand
tags: []
priority: 50
shareable: false
---
alpha VECTOR_FAVOR_A
`,
  );
  await storage.writeAtomic(
    "world/knowledge/vector-b.md",
    `---
name: vector-b
description: doc b
scope: world
inject: on-demand
tags: []
priority: 50
shareable: false
---
alpha beta beta VECTOR_FAVOR_B
`,
  );
}

export function memoryStoryLlm(opts?: ScriptedLlmOptions): ScriptedLlm {
  let sceneTurn = 0;
  return scriptedLlm({
    ...opts,
    s1: (req, n) => {
      const custom = opts?.s1?.(req, n);
      if (custom !== undefined) return custom;
      if (req.label === "appraise") {
        sceneTurn += 1;
        return {
          type: sceneTurn === 2 ? "care" : "chat",
          intensity: 0.55,
          sincerity: 0.9,
          claims: [],
          search_terms:
            sceneTurn === 1 ? ["tavern", "meeting"] : sceneTurn === 3 ? ["REFLECTED_TAVERN", "summary"] : ["NPC2_PRIVATE_CODeword"],
          tags: ["social"],
          input_class: "normal",
        };
      }
      if (req.label === "reflect") {
        return {
          summaries: ["REFLECTED_TAVERN summary from scene one."],
          goal_changes: [],
          new_claims: [],
        };
      }
      return undefined;
    },
    s2: (req, n) => {
      const custom = opts?.s2?.(req, n);
      if (custom !== undefined) return custom;
      if (req.label === "render") {
        return { text: `Memory line ${n}.`, cues: [], intent_realized: "talk" };
      }
      return undefined;
    },
  });
}

export { seedE2eAuthored, scriptedLlm };
