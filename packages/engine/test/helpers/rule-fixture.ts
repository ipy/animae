import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import type { CreateEngineOptions, Engine } from "../../src/api.ts";
import type { PresetBundle } from "../../src/preset.ts";
import { FsStorage } from "../../src/store/fs.ts";
import type { EngineEvent, SceneId, TurnChunk } from "../../src/types.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

/**
 * A policy that can play on the rule backend: appraise patterns, template layers (one utterance layer per event type,
 * two narration layers, a scene break that fires on the word "later") and choice rules. Layered on top of the e2e
 * preset, whose policy defines the event types, tracks and intents these templates refer to.
 */
export const RULE_POLICY_DOC = {
  appraise: {
    patterns: [{ match: "\\b(thanks|thank you)\\b", event: { type: "care", intensity: 0.7, sincerity: 0.8 } }],
    fallback: { type: "chat", intensity: 0.4, sincerity: 0.6 },
  },
  render: {
    layers: [
      {
        id: "care-reply",
        when: "event.type == 'care'",
        pool: [
          { text: "That means a lot to me.", intent: "talk" },
          { text: "You are kind to say so.", intent: "talk" },
        ],
      },
      {
        id: "chat-reply",
        when: "true",
        pool: [
          { text: "Aria nods: {{ input.text }}", weight: 3, intent: "talk" },
          { text: "Hm.", weight: 1, intent: "listen" },
        ],
      },
      {
        id: "weather",
        when: "true",
        pool: [
          { text: "Rain taps the window.", style: "narration" },
          { text: "The fire crackles low.", style: "narration" },
        ],
      },
      {
        id: "time-skip",
        when: "input.text.contains('later')",
        pool: [{ text: "Three hours later.", style: "narration_break" }],
      },
    ],
    fallback: { text: "Aria says nothing." },
  },
  choices: {
    enabled: true,
    count: 2,
    rules: [
      { id: "thank", text: "Thank her.", event_type: "care", intensity: 0.7 },
      { id: "ask", text: "Ask about the rain.", event_type: "chat" },
    ],
  },
};

/**
 * The e2e preset plus {@link RULE_POLICY_DOC}; `extra` is a further policy document layered on top. It keeps the id
 * `e2e` because the seeded `animae.yaml` names that preset.
 */
export function rulePreset(extra?: unknown): PresetBundle {
  return {
    ...e2ePreset,
    policies: [
      ...e2ePreset.policies,
      { name: "rule.yaml", doc: RULE_POLICY_DOC },
      ...(extra === undefined ? [] : [{ name: "extra.yaml", doc: extra }]),
    ],
  };
}

export interface RuleEngineHandle {
  engine: Engine;
  root: string;
  /** Open another engine on the same data root (a fresh process reading the same timeline). */
  reopen(opts?: Partial<CreateEngineOptions>): Promise<Engine>;
  dispose(): Promise<void>;
}

export interface OpenRuleEngineOptions extends Partial<Omit<CreateEngineOptions, "root">> {
  /** preset to run; default {@link rulePreset} */
  preset?: PresetBundle;
  /** extra top-level `animae.yaml` text appended to the seeded config (for example `runtime:\n  switchAt: immediate`) */
  yaml?: string;
}

/** Open an engine on a fresh temp data root seeded with the e2e world (player, Aria, Ben, a tavern). */
export async function openRuleEngine(opts: OpenRuleEngineOptions = {}): Promise<RuleEngineHandle> {
  const root = await mkdtemp(join(tmpdir(), "animae-rule-"));
  await seedE2eAuthored(FsStorage(root));
  const { preset = rulePreset(), yaml, ...rest } = opts;
  if (yaml) await FsStorage(root).writeAtomic("animae.yaml", `seed: 42\npreset: e2e\npolicies: []\n${yaml}\n`);
  const open = (o: Partial<CreateEngineOptions> = {}) =>
    createEngine({
      root,
      ports: { storage: FsStorage(root) },
      presets: [preset],
      ...rest,
      ...o,
    });
  const opened: Engine[] = [await open()];
  return {
    engine: opened[0]!,
    root,
    async reopen(o) {
      const e = await open(o);
      opened.push(e);
      return e;
    },
    async dispose() {
      for (const e of opened) await e.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Drain one player turn to the end and return its chunks. */
export async function playTurn(
  engine: Engine,
  sceneId: SceneId,
  text: string,
  extra: { addressee?: string; choiceId?: string } = { addressee: "npc1" },
): Promise<TurnChunk[]> {
  const chunks: TurnChunk[] = [];
  for await (const c of engine.scene.turn({ sceneId, actor: "player", text, ...extra })) chunks.push(c);
  return chunks;
}

/** Start the standard scene: the player talking with Aria in the tavern. */
export function startScene(engine: Engine): Promise<SceneId> {
  return engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
}

/** Events of the current branch, by kind. */
export async function eventsOf(engine: Engine, ...kinds: string[]): Promise<EngineEvent[]> {
  return engine.timeline.events(kinds.length ? { kinds } : undefined);
}

/** Narration paragraphs of a chunk list, in order, as `[style, text]`. */
export function narrationsOf(chunks: readonly TurnChunk[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const c of chunks) {
    if (c.type !== "narration") continue;
    const style = c.style ?? "normal";
    const last = out.at(-1);
    if (last && c.newParagraph !== true && last[0] === style) last[1] += c.text;
    else out.push([style, c.text]);
  }
  return out;
}

/** The NPC's spoken line of a chunk list (everything after the player's echo). */
export function npcLine(chunks: readonly TurnChunk[]): string {
  return chunks
    .filter((c): c is Extract<TurnChunk, { type: "text" }> => c.type === "text" && c.speaker !== "player")
    .map((c) => c.text)
    .join("");
}
