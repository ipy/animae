#!/usr/bin/env bun
/**
 * Dev harness: real Lilium data + ScriptedModel + BasePanel side section.
 * Batch mode (for pty-render.py): `--batch <scenario>`; must run under a PTY.
 */
import { runTui } from "../src/run-tui.ts";
import { defaultLayout } from "../src/layout/default-layout.tsx";
import { copyLiliumDataRoot } from "./copy-lilium-data.ts";
import { openLiliumEngine } from "../../../../games/lilium/src/game/bootstrap.ts";
import {
  createLiliumScriptedModels,
  type TurnScript,
} from "../../../../games/lilium/test/e2e/scripted-model.ts";
import { BasePanel } from "../../../../games/lilium/src/ui/base-panel.tsx";
import type { ModelPort, PromptSegments } from "@animae/engine";
import type { CustomCommand } from "../src/types.ts";
import type { ThemePatch } from "../src/theme/schema.ts";
import qaKeys from "./qa-scenario-keys.json";

function actorTextFromSegments(segments: PromptSegments | undefined): string {
  const user = segments?.user ?? "";
  const m = /Actor text:\n([\s\S]*)/.exec(user);
  return m?.[1]?.trim() ?? "";
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
        const shouldFail =
          actorLine.includes("trigger-error") || blob.includes("trigger-error");
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
  text: "你好，世界！「全角标点」与ASCII mix 123。",
  cues: [
    { type: "expression", args: { name: "微笑" }, at: 0 },
    { type: "action", args: { text: "她轻轻理了理鬓发" }, at: 4 },
    { type: "sfx", args: { name: "风铃" }, at: 8 },
  ],
  choices: [
    { text: "继续聊", expected_event_type: "chat", tags: [] },
    { text: "换个话题", expected_event_type: "chat", tags: [] },
    { text: "先忙别的", expected_event_type: "other", tags: [] },
  ],
};

const SLOW_RENDER: TurnScript["render"] = {
  text: "打字机效果测试：逐字显示这段较长的中文台词，便于在中途截屏。",
  cues: [{ type: "expression", args: { name: "专注" }, at: 0 }],
  choices: [],
};

const SCRIPTS: TurnScript[] = [
  { match: "", appraise: { type: "teamwork", intensity: 0.5 }, render: CJK_RENDER },
  { match: "chat", appraise: { type: "teamwork", intensity: 0.45 } },
  {
    match: "trigger-error",
    appraise: { type: "teamwork", intensity: 0.5 },
    render: { text: "这条台词会在中途失败。", cues: [], choices: [] },
  },
  { match: "slow", appraise: { type: "teamwork", intensity: 0.4 }, render: SLOW_RENDER },
];

type ScenarioKeys = { readyMs: number; delayMs: number; keys: string[] };
type Scenario = ScenarioKeys & {
  scene?: { location: string; participants: string[] } | false;
  initialMessage?: string;
  theme?: ThemePatch;
};

const SCENARIO_META: Record<string, Omit<Scenario, keyof ScenarioKeys>> = {
  empty: { scene: false, initialMessage: "QA: empty state (no scene)." },
  "scene-start": {
    scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi", "cen-wu"] },
  },
  "typewriter-mid": {
    scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi"] },
    theme: { typewriter: { charsPerSecond: 8, enabled: true } },
  },
  "typewriter-done": {
    scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi"] },
    theme: { typewriter: { charsPerSecond: 40, enabled: true } },
  },
  typewriter: { scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi"] } },
  cjk: { scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi"] } },
  choices: { scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi"] } },
  sidepanel: {
    scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi", "cen-wu"] },
  },
  help: { scene: false },
  "event-log": { scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi"] } },
  timeline: { scene: false },
  explain: { scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi"] } },
  inspector: { scene: false },
  "long-scroll": { scene: false },
  narrow: { scene: false },
  "model-error": { scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi"] } },
  rewind: { scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi"] } },
  "rapid-input": {
    scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi"] },
    theme: { typewriter: { charsPerSecond: 6, enabled: true } },
  },
  "resize-mid": {
    scene: { location: "greenhouse-hall", participants: ["player", "bai-zhi", "cen-wu"] },
  },
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

  const { root, cleanup } = await copyLiliumDataRoot();
  const baseModels = createLiliumScriptedModels(SCRIPTS);
  const models = {
    s1: injectMidStreamErrors(baseModels.s1),
    s2: injectMidStreamErrors(baseModels.s2),
  };
  const engine = await openLiliumEngine({ root, models, modelMode: "record", seed: 7 });

  if (batch) {
    process.env.COLUMNS = String(cols);
    process.env.LINES = String(rows);
  }

  const runOpts = {
    engine,
    viewer: "player" as const,
    actor: "player",
    layout: defaultLayout,
    theme: scenario?.theme,
    commands: devCommands,
    panels: [
      {
        id: "lilium-base",
        title: "基地",
        order: -10,
        render: BasePanel,
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
  }
}

await main();
