#!/usr/bin/env bun
/**
 * Dev harness: demo e2e data + ScriptedModel + side panel (engine-neutral).
 */
import { createEngine } from "@animae/engine";
import { e2ePreset } from "../../engine/test/e2e/fixture.ts";
import { runTui } from "../src/run-tui.ts";
import { defaultLayout } from "../src/layout/default-layout.tsx";
import { copyDemoDataRoot } from "./copy-demo-data.ts";
import { createDemoScriptedModels, type TurnScript } from "./scripted-models.ts";
import { DemoSidePanel } from "../src/panels/demo-side-panel.tsx";
import type { ModelPort, PromptSegments } from "@animae/engine";
import type { CustomCommand } from "../src/types.ts";
import type { ThemePatch } from "../src/theme/schema.ts";
import qaKeys from "./qa-scenario-keys.json";

/** The appraise user message wraps the actor's text in locale-independent `<<<ACTOR_INPUT>>>` markers. */
function actorTextFromSegments(segments: PromptSegments | undefined): string {
  const user = segments?.user ?? "";
  const delimited = /<<<ACTOR_INPUT>>>\n([\s\S]*?)\n<<<END_ACTOR_INPUT>>>/.exec(user);
  if (delimited) return delimited[1]!.trim();
  const legacy = /Actor text:\n([\s\S]*)/.exec(user);
  return legacy?.[1]?.trim() ?? "";
}

function injectMidStreamErrors(port: ModelPort): ModelPort {
  return {
    ...port,
    stream(req) {
      const inner = port.stream(req);
      async function* wrapped() {
        let parts = 0;
        const actorLine = actorTextFromSegments(req.segments).toLowerCase();
        const blob = JSON.stringify(req.segments ?? {}).toLowerCase();
        const shouldFail = actorLine.includes("trigger-error") || blob.includes("trigger-error");
        for await (const part of inner) {
          yield part;
          parts += 1;
          if (req.label === "render" && shouldFail && parts >= 1) {
            throw new Error("Simulated model failure mid-stream");
          }
        }
      }
      return wrapped();
    },
  };
}

const CJK_RENDER: TurnScript["render"] = {
  text: "Hello — demo CJK 你好，世界！",
  cues: [
    { type: "expression", args: { name: "smile" }, at: 0 },
    { type: "action", args: { text: "waves" }, at: 4 },
  ],
  choices: [
    { text: "Continue", expected_event_type: "chat", tags: [] },
    { text: "Other topic", expected_event_type: "chat", tags: [] },
  ],
};

const SLOW_RENDER: TurnScript["render"] = {
  text: "Typewriter demo: longer line for mid-screenshot capture.",
  cues: [{ type: "expression", args: { name: "focus" }, at: 0 }],
  choices: [],
};

const SCRIPTS: TurnScript[] = [
  { match: "", appraise: { type: "chat", intensity: 0.5 }, render: CJK_RENDER },
  { match: "chat", appraise: { type: "chat", intensity: 0.45 } },
  {
    match: "trigger-error",
    appraise: { type: "chat", intensity: 0.5 },
    render: { text: "This line fails mid-stream.", cues: [], choices: [] },
  },
  { match: "slow", appraise: { type: "chat", intensity: 0.4 }, render: SLOW_RENDER },
];

type ScenarioKeys = { readyMs: number; delayMs: number; keys: string[] };
type Scenario = ScenarioKeys & {
  scene?: { location: string; participants: string[] } | false;
  initialMessage?: string;
  theme?: ThemePatch;
};

const SCENARIO_META: Record<string, Omit<Scenario, keyof ScenarioKeys>> = {
  empty: { scene: false, initialMessage: "QA: empty state (no scene)." },
  "scene-start": { scene: { location: "tavern", participants: ["player", "npc1", "npc2"] } },
  "typewriter-mid": {
    scene: { location: "tavern", participants: ["player", "npc1"] },
    theme: { typewriter: { charsPerSecond: 8, enabled: true } },
  },
  "typewriter-done": {
    scene: { location: "tavern", participants: ["player", "npc1"] },
    theme: { typewriter: { charsPerSecond: 40, enabled: true } },
  },
  typewriter: { scene: { location: "tavern", participants: ["player", "npc1"] } },
  cjk: { scene: { location: "tavern", participants: ["player", "npc1"] } },
  choices: { scene: { location: "tavern", participants: ["player", "npc1"] } },
  sidepanel: { scene: { location: "tavern", participants: ["player", "npc1", "npc2"] } },
  help: { scene: false },
  "event-log": { scene: { location: "tavern", participants: ["player", "npc1"] } },
  timeline: { scene: false },
  explain: { scene: { location: "tavern", participants: ["player", "npc1"] } },
  inspector: { scene: false },
  "long-scroll": { scene: false },
  narrow: { scene: false },
  "model-error": { scene: { location: "tavern", participants: ["player", "npc1"] } },
  rewind: { scene: { location: "tavern", participants: ["player", "npc1"] } },
  "rapid-input": {
    scene: { location: "tavern", participants: ["player", "npc1"] },
    theme: { typewriter: { charsPerSecond: 6, enabled: true } },
  },
  "resize-mid": { scene: { location: "tavern", participants: ["player", "npc1", "npc2"] } },
};

const SCENARIOS: Record<string, Scenario> = Object.fromEntries(
  Object.entries(qaKeys as Record<string, ScenarioKeys>).map(([name, keys]) => [
    name,
    { ...keys, ...(SCENARIO_META[name] ?? {}) },
  ]),
);

const devCommands: Record<string, CustomCommand> = {
  flood: {
    description: "Fill transcript with lines (QA)",
    run: async (_args, api) => {
      for (let i = 0; i < 200; i++) {
        api.notify(`scroll line ${String(i).padStart(3, "0")}`);
        if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
      }
    },
  },
};

function parseArgs(argv: string[]) {
  let batch: string | undefined;
  let cols = 120;
  let rows = 40;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--batch") batch = argv[++i];
    else if (a === "--cols") cols = Number(argv[++i]);
    else if (a === "--rows") rows = Number(argv[++i]);
  }
  return { batch, cols, rows };
}

function scheduleKeyInjection(scenario: Scenario) {
  if (process.env.TUI_PTY_DRIVER === "1") return;
  if (scenario.keys.length === 0) return;
  let i = 0;
  const sendNext = () => {
    if (i >= scenario.keys.length) return;
    const chunk = Buffer.from(scenario.keys[i]!, "utf8");
    if (typeof process.stdin.push === "function") {
      process.stdin.push(chunk);
    } else {
      process.stdin.emit("data", chunk);
    }
    i += 1;
    if (i < scenario.keys.length) setTimeout(sendNext, scenario.delayMs ?? 400);
  };
  setTimeout(sendNext, scenario.readyMs ?? 450);
}

async function main() {
  const { batch, cols, rows } = parseArgs(process.argv.slice(2));
  const scenario = batch ? SCENARIOS[batch] : undefined;
  if (batch && !scenario) {
    console.error(`Unknown scenario: ${batch}`);
    process.exit(1);
  }

  const { root, cleanup } = await copyDemoDataRoot();
  const baseModels = createDemoScriptedModels(SCRIPTS);
  const models = {
    s1: injectMidStreamErrors(baseModels.s1),
    s2: injectMidStreamErrors(baseModels.s2),
  };
  const engine = await createEngine({ root, presets: [e2ePreset], models, modelMode: "record", seed: 7 });

  if (batch) {
    process.env.COLUMNS = String(cols);
    process.env.LINES = String(rows);
  }

  const uiLocale = process.env.ANIMAE_LOCALE?.trim() || undefined;

  const runOpts = {
    engine,
    viewer: "player" as const,
    actor: "player",
    layout: defaultLayout,
    uiLocale,
    theme: scenario?.theme,
    commands: devCommands,
    panels: [
      {
        id: "demo-side",
        title: "Demo",
        order: -10,
        render: DemoSidePanel,
      },
    ],
    scene: scenario?.scene === false ? undefined : scenario?.scene ?? undefined,
    initialMessage: scenario?.initialMessage,
    onReady: () => {
      if (batch) process.stderr.write("TUI_READY\n");
      if (!batch || !scenario) return;
      scheduleKeyInjection(scenario);
    },
  };

  try {
    await runTui(runOpts);
  } finally {
    await cleanup();
    await engine.close();
  }
}

await main();
