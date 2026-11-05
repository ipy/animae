import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NarrationEventSchema, NarrationItemSchema, NarrationStyleSchema, narrationDraft } from "../../src/narration.ts";
import { renderStage } from "../../src/pipeline/render.ts";
import type { RenderPart, RenderResult } from "../../src/pipeline/types.ts";
import {
  applyNarrationTurnChunk,
  applyTextTurnChunk,
  createParagraphStreamState,
  createUtteranceStreamState,
} from "../../src/turn-chunk-accumulate.ts";
import type { TurnChunk } from "../../src/types.ts";
import { createPipelineKernel, S2_BINDING } from "../pipeline/test-kernel.ts";
import { scriptedLlm } from "../helpers/llm-scripts.ts";
import {
  eventsOf,
  narrationsOf,
  npcLine,
  openRuleEngine,
  playTurn,
  rulePreset,
  startScene,
} from "../helpers/rule-fixture.ts";

// ───────────────────────── schema ─────────────────────────

describe("narration schema", () => {
  test("style defaults to normal and only knows two styles", () => {
    expect(NarrationStyleSchema.options).toEqual(["normal", "scene_break"]);
    expect(NarrationItemSchema.parse({ text: "Rain taps." })).toEqual({ style: "normal", text: "Rain taps." });
    expect(NarrationItemSchema.parse({ text: "Later.", style: "scene_break" })).toEqual({ style: "scene_break", text: "Later." });
    expect(() => NarrationItemSchema.parse({ text: "Psst.", style: "aside" })).toThrow();
    expect(() => NarrationItemSchema.parse({ text: "  " })).toThrow();
    expect(() => NarrationItemSchema.parse({ text: "x", speaker: "npc1" })).toThrow();
  });

  test("the narration event is speaker-less and carries its style", () => {
    expect(NarrationEventSchema.parse({ kind: "narration", text: "Rain taps." })).toEqual({
      kind: "narration",
      text: "Rain taps.",
      style: "normal",
    });
    expect(() => NarrationEventSchema.parse({ kind: "narration", text: "x", speaker: "npc1" })).toThrow();
    // a draft always states its style, so a replay never depends on a default
    expect(narrationDraft("Rain taps.")).toMatchObject({ kind: "narration", style: "normal", text: "Rain taps." });
    expect(narrationDraft("Later.", "scene_break")).toMatchObject({ style: "scene_break" });
  });
});

// ───────────────────────── LLM streaming ─────────────────────────

const POLICY = {
  events: { types: { chat: { positive: true } } },
  intent: { types: ["respond"] },
  choices: { enabled: false, count: 3, filter: "true" },
  render: { retryOnMismatch: 0, recentTurns: 4 },
};
const TURN = { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "x", autonomous: false };

async function renderParts(s2Handler: () => unknown): Promise<{ parts: RenderPart[]; result: RenderResult }> {
  const { k } = createPipelineKernel({ policy: POLICY as never, s2Handler: s2Handler as never });
  const gen = renderStage(k, TURN, {
    binding: S2_BINDING,
    speaker: "npc1",
    addressee: "player",
    intent: { intent: "respond", scores: { respond: 1 } },
    appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
    fieldEffects: {},
    scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
    history: [],
    sidenotes: [],
    hits: [],
  });
  const parts: RenderPart[] = [];
  for (;;) {
    const n = await gen.next();
    if (n.done) return { parts, result: n.value };
    parts.push(n.value);
  }
}

/** What a consumer builds from a chunk list with the shared accumulation helpers: paragraphs and utterances. */
function accumulate(chunks: readonly TurnChunk[]): { paragraphs: Array<[string, string]>; utterances: string[] } {
  let p = createParagraphStreamState();
  let u = createUtteranceStreamState();
  const paragraphs: Array<[string, string]> = [];
  const utterances: string[] = [];
  for (const c of chunks) {
    if (c.type === "narration") {
      const r = applyNarrationTurnChunk(p, c);
      if (r.newParagraph) paragraphs.push([r.state.style, c.text]);
      else paragraphs[paragraphs.length - 1]![1] += c.text;
      p = r.state;
    } else if (c.type === "text") {
      p = createParagraphStreamState();
      const r = applyTextTurnChunk(u, c);
      if (r.newUtterance) utterances.push(c.text);
      else utterances[utterances.length - 1] += c.text;
      u = r.state;
    }
  }
  return { paragraphs, utterances };
}

describe("narration from a model streams as paragraphs", () => {
  test("fragments of one paragraph continue it; each paragraph's first fragment says `newParagraph`", async () => {
    const { parts, result } = await renderParts(async function* () {
      yield { narrations: [{ style: "normal" }] };
      yield { narrations: [{ style: "normal", text: "Rain " }] };
      yield { narrations: [{ style: "normal", text: "Rain taps." }, { style: "scene_break" }] };
      yield { narrations: [{ style: "normal", text: "Rain taps." }, { style: "scene_break", text: "Later" }], text: "Hel" };
      yield {
        narrations: [
          { style: "normal", text: "Rain taps." },
          { style: "scene_break", text: "Later" },
        ],
        text: "Hello",
        cues: [],
        intent_realized: "respond",
      };
    });
    const narr = parts.filter((p) => p.type === "narration");
    expect(narr).toEqual([
      { type: "narration", text: "Rain ", style: "normal", newParagraph: true },
      { type: "narration", text: "taps.", style: "normal" },
      { type: "narration", text: "Later", style: "scene_break", newParagraph: true },
    ]);
    // narration comes before the utterance, which streams as before
    const firstText = parts.findIndex((p) => p.type === "text");
    const lastNarration = parts.map((p) => p.type).lastIndexOf("narration");
    expect(lastNarration).toBeLessThan(firstText);
    expect(parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")).toBe("Hello");
    expect(result.narrations).toEqual([
      { text: "Rain taps.", style: "normal" },
      { text: "Later", style: "scene_break" },
    ]);

    const acc = accumulate(parts.filter((p): p is Extract<RenderPart, { type: "narration" | "text" }> => p.type === "narration" || p.type === "text") as TurnChunk[]);
    expect(acc.paragraphs).toEqual([
      ["normal", "Rain taps."],
      ["scene_break", "Later"],
    ]);
    expect(acc.utterances).toEqual(["Hello"]);
  });

  test("a paragraph that only appears in the final answer is flushed whole, before the utterance", async () => {
    const { parts } = await renderParts(() => ({
      narrations: [{ style: "normal", text: "The fire crackles." }],
      text: "Hello",
      cues: [],
      intent_realized: "respond",
    }));
    expect(parts.map((p) => p.type)).toEqual(["narration", "text"]);
    expect(parts[0]).toEqual({ type: "narration", text: "The fire crackles.", style: "normal", newParagraph: true });
  });

  test("no narrations in the answer: no narration chunk, and the utterance streams exactly as before", async () => {
    const { parts, result } = await renderParts(async function* () {
      yield { text: "Hel" };
      yield { text: "Hello", cues: [], intent_realized: "respond" };
    });
    expect(parts.filter((p) => p.type === "narration")).toEqual([]);
    expect(parts.map((p) => (p.type === "text" ? p.text : p.type))).toEqual(["Hel", "lo"]);
    expect(result.narrations).toEqual([]);
  });

  test("through the engine: chunks, events and replay all carry the paragraphs", async () => {
    const llm = scriptedLlm({
      narrations: [
        { text: "Rain taps the glass.", style: "normal" },
        { text: "Three hours later.", style: "scene_break" },
      ],
    });
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const chunks = await playTurn(engine, sceneId, "hello");
      expect(narrationsOf(chunks)).toEqual([
        ["normal", "Rain taps the glass."],
        ["scene_break", "Three hours later."],
      ]);
      // narration is told before the NPC answers, and the turn still ends with `done`
      const types = chunks.map((c) => c.type);
      expect(types.indexOf("narration")).toBeLessThan(types.lastIndexOf("text"));
      expect(types.at(-1)).toBe("done");

      const events = (await eventsOf(engine, "narration")) as unknown as Array<{ text: string; style: string; speaker?: string }>;
      expect(events.map((e) => [e.style, e.text])).toEqual([
        ["normal", "Rain taps the glass."],
        ["scene_break", "Three hours later."],
      ]);
      for (const e of events) expect(e.speaker).toBeUndefined();

      const replayed: TurnChunk[] = [];
      for await (const c of engine.timeline.replay(engine.timeline.current())) replayed.push(c);
      expect(narrationsOf(replayed)).toEqual(narrationsOf(chunks));
    } finally {
      await h.dispose();
    }
  });

  test("a model that writes no narration: turns have no narration chunks or events (backward compatible)", async () => {
    const llm = scriptedLlm();
    const h = await openRuleEngine({ models: { s1: llm.s1, s2: llm.s2 }, mode: "full" });
    try {
      const { engine } = h;
      const sceneId = await startScene(engine);
      const chunks = await playTurn(engine, sceneId, "hello");
      expect(chunks.some((c) => c.type === "narration")).toBe(false);
      expect(await eventsOf(engine, "narration")).toHaveLength(0);
      expect(npcLine(chunks)).toContain("Hello from the model");
    } finally {
      await h.dispose();
    }
  });
});

// ───────────────────────── rule backend ─────────────────────────

describe("narration from the rule backend", () => {
  test("`narration` lines are normal paragraphs, `narration_break` lines are scene breaks, in layer order", async () => {
    const h = await openRuleEngine();
    try {
      const sceneId = await startScene(h.engine);
      const plain = await playTurn(h.engine, sceneId, "hello there");
      expect(narrationsOf(plain).map(([style]) => style)).toEqual(["normal"]);
      const later = await playTurn(h.engine, sceneId, "see you later");
      expect(narrationsOf(later).map(([style]) => style)).toEqual(["normal", "scene_break"]);
      expect(narrationsOf(later)[1]![1]).toBe("Three hours later.");
      const events = (await eventsOf(h.engine, "narration")) as unknown as Array<{ style: string }>;
      expect(events.map((e) => e.style)).toEqual(["normal", "normal", "scene_break"]);
    } finally {
      await h.dispose();
    }
  });

  test("narration never changes what the character says, what it realizes or how the input is appraised", async () => {
    const withNarration = await openRuleEngine();
    // the same policy with the narration layers removed
    const full = rulePreset({});
    const doc = full.policies.find((p) => p.name === "rule.yaml")!.doc as { render: { layers: { pool: { style?: string }[] }[] } };
    const bare = {
      ...full,
      policies: full.policies.map((p) =>
        p.name === "rule.yaml"
          ? { ...p, doc: { ...doc, render: { ...doc.render, layers: doc.render.layers.filter((l) => l.pool[0]!.style === undefined) } } }
          : p,
      ),
    };
    const without = await openRuleEngine({ preset: bare });
    try {
      const a = await startScene(withNarration.engine);
      const b = await startScene(without.engine);
      const lines = ["hello there", "thanks a lot", "see you later"];
      for (const [i, line] of lines.entries()) {
        const ca = await playTurn(withNarration.engine, a, line);
        const cb = await playTurn(without.engine, b, line);
        expect(narrationsOf(cb)).toEqual([]);
        expect(narrationsOf(ca).length).toBeGreaterThan(0);
        // a turn's draws are seeded from its input event, which narration events of earlier turns move: the first turn
        // is the one that must match line for line
        if (i === 0) expect(npcLine(ca)).toBe(npcLine(cb));
      }
      type U = { text: string; intent: string };
      const intents = async (e: typeof withNarration.engine) =>
        ((await eventsOf(e, "utterance")) as unknown as U[]).map((u) => u.intent);
      const decided = async (e: typeof withNarration.engine) =>
        ((await eventsOf(e, "intent.decided")) as unknown as Array<{ intent: string }>).map((d) => d.intent);
      // the intent an utterance carries is the decided one, with or without narration beside it
      expect(await intents(withNarration.engine)).toEqual(await intents(without.engine));
      expect(await intents(withNarration.engine)).toEqual(await decided(withNarration.engine));
      expect(await decided(withNarration.engine)).toEqual(await decided(without.engine));
      type A = { appraisal: unknown };
      const appraisals = async (e: typeof withNarration.engine) => ((await eventsOf(e, "appraisal")) as unknown as A[]).map((x) => x.appraisal);
      expect(await appraisals(withNarration.engine)).toEqual(await appraisals(without.engine));
      expect(await eventsOf(withNarration.engine, "intent.mismatch")).toHaveLength(0);
    } finally {
      await withNarration.dispose();
      await without.dispose();
    }
  });

  test("the text and style of narration are deterministic for a seed", async () => {
    const picks = async (seed: number) => {
      const h = await openRuleEngine({ seed });
      try {
        const sceneId = await startScene(h.engine);
        const out: Array<[string, string]> = [];
        for (const line of ["one", "two", "three later", "four"]) out.push(...narrationsOf(await playTurn(h.engine, sceneId, line)));
        return out;
      } finally {
        await h.dispose();
      }
    };
    // every draw comes from the seeded rng: the same seed tells the same story
    expect(await picks(9)).toEqual(await picks(9));
  });
});

// ───────────────────────── memory ─────────────────────────

describe("what narration leaves in memory (memory.writing.narration)", () => {
  type Mem = { kind: string; text: string; tags: string[]; shareable?: boolean; src?: string };
  type Handle = Awaited<ReturnType<typeof openRuleEngine>>;
  /** A character's memories that narration wrote, read from the memory log on disk. */
  async function memoryOf(h: Handle, id: string): Promise<Mem[]> {
    let raw = "";
    try {
      raw = await readFile(join(h.root, "timelines", "main", "artifacts", id, "memory.jsonl"), "utf8");
    } catch {
      return [];
    }
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Mem)
      .filter((m) => m.tags.includes("narration"));
  }

  async function run(mode: "none" | "inject_belief" | "shareable" | undefined) {
    const extra = mode ? { memory: { writing: { narration: mode } } } : undefined;
    const h = await openRuleEngine({ preset: rulePreset(extra) });
    const sceneId = await startScene(h.engine);
    await playTurn(h.engine, sceneId, "hello there");
    await playTurn(h.engine, sceneId, "see you later");
    return h;
  }

  test("none (the default): narration is for the player's eyes only", async () => {
    for (const mode of [undefined, "none"] as const) {
      const h = await run(mode);
      try {
        expect(await memoryOf(h, "npc1")).toEqual([]);
        expect(await memoryOf(h, "player")).toEqual([]);
      } finally {
        await h.dispose();
      }
    }
  });

  test("inject_belief: the NPCs in the scene hold each paragraph as an established fact; scene breaks are not memory", async () => {
    const h = await run("inject_belief");
    try {
      const mem = await memoryOf(h, "npc1");
      expect(mem.length).toBe(2);
      for (const m of mem) {
        expect(m.kind).toBe("semantic");
        expect(m.tags).toEqual(["narration"]);
        expect(m.shareable).toBeFalsy();
      }
      expect(mem.map((m) => m.text).some((t) => t.includes("Three hours later"))).toBe(false);
      // the player is not a witness
      expect(await memoryOf(h, "player")).toEqual([]);
      // an NPC who is not in the scene knows nothing of it
      expect(await memoryOf(h, "npc2")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  test("shareable: the paragraph is an episodic memory that can spread like hearsay", async () => {
    const h = await run("shareable");
    try {
      const mem = await memoryOf(h, "npc1");
      expect(mem.length).toBe(2);
      for (const m of mem) {
        expect(m.kind).toBe("episodic");
        expect(m.tags).toEqual(["narration", "shareable"]);
        expect(m.shareable).toBe(true);
      }
    } finally {
      await h.dispose();
    }
  });

  test("a scene with no one but the player has nobody to remember the narration", async () => {
    const h = await openRuleEngine({ preset: rulePreset({ memory: { writing: { narration: "inject_belief" } } }) });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player"] });
      await playTurn(h.engine, sceneId, "hello there", {});
      expect((await eventsOf(h.engine, "narration")).length).toBeGreaterThan(0);
      for (const id of ["npc1", "npc2", "player"]) expect(await memoryOf(h, id)).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

// ───────────────────────── visibility ─────────────────────────

describe("narration visibility (events/narration, events/narration/style:scene_break)", () => {
  type Row = { id: string; kind: string; style?: string; text?: string };
  const AFTER_TWO_TURNS = async (extra: unknown) => {
    const h = await openRuleEngine({ preset: rulePreset(extra) });
    const sceneId = await startScene(h.engine);
    await playTurn(h.engine, sceneId, "hello there");
    await playTurn(h.engine, sceneId, "see you later");
    return h;
  };
  const ALLOW_EVENTS = { viewer: "player", path: "events", allow: true };
  const rows = (engine: Awaited<ReturnType<typeof openRuleEngine>>["engine"], viewer: string) =>
    ((engine.query(viewer, "events") as Row[] | undefined) ?? []).filter((r) => r.kind === "narration");

  test("by default a viewer who may read events sees narration, with its style and text", async () => {
    const h = await AFTER_TWO_TURNS({ visibility: { rules: [ALLOW_EVENTS] } });
    try {
      const seen = rows(h.engine, "player");
      expect(seen.map((r) => r.style)).toEqual(["normal", "normal", "scene_break"]);
      expect(seen.every((r) => typeof r.text === "string" && r.text.length > 0)).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  test("denying events/narration hides every paragraph from query and explain; others still see them", async () => {
    const h = await AFTER_TWO_TURNS({
      visibility: {
        rules: [
          ALLOW_EVENTS,
          { viewer: "gm", path: "events", allow: true },
          { viewer: "player", path: "events/narration", allow: false },
        ],
      },
    });
    try {
      const { engine } = h;
      expect(rows(engine, "player")).toEqual([]);
      // the rest of the log is untouched
      const all = engine.query("player", "events") as Row[];
      expect(all.some((r) => r.kind === "utterance")).toBe(true);
      expect(rows(engine, "gm").length).toBe(3);
      expect(rows(engine, "debug").length).toBe(3);
      const turnId = (await eventsOf(engine, "narration"))[0]!.turn!;
      const kinds = (v: string) => engine.explain(turnId, v).chain.map((c) => c.kind);
      expect(kinds("player")).not.toContain("narration");
      expect(kinds("player")).toContain("utterance");
      expect(kinds("gm")).toContain("narration");
    } finally {
      await h.dispose();
    }
  });

  test("denying only events/narration/style:scene_break hides the dividers and keeps the paragraphs", async () => {
    const h = await AFTER_TWO_TURNS({
      visibility: { rules: [ALLOW_EVENTS, { viewer: "player", path: "events/narration/style:scene_break", allow: false }] },
    });
    try {
      const seen = rows(h.engine, "player");
      expect(seen.map((r) => r.style)).toEqual(["normal", "normal"]);
    } finally {
      await h.dispose();
    }
  });

  test("a grant brings hidden narration back for the viewer", async () => {
    const h = await AFTER_TWO_TURNS({
      visibility: { rules: [ALLOW_EVENTS, { viewer: "player", path: "events/narration", allow: false }] },
    });
    try {
      expect(rows(h.engine, "player")).toEqual([]);
      await h.engine.grant("player", "events/narration");
      expect(rows(h.engine, "player").length).toBe(3);
      await h.engine.revoke("player", "events/narration");
      expect(rows(h.engine, "player")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  test("a viewer who may not read events at all sees no narration either (a narration rule never widens access)", async () => {
    const h = await AFTER_TWO_TURNS({ visibility: { rules: [{ viewer: "player", path: "events/narration", allow: true }] } });
    try {
      expect(h.engine.query("player", "events")).toBeUndefined();
    } finally {
      await h.dispose();
    }
  });
});
