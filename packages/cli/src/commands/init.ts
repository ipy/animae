import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolvePresetId } from "../presets.ts";

export interface InitOptions {
  dir: string;
  preset?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runInit(opts: InitOptions): Promise<number> {
  const target = resolve(opts.dir);
  if (await exists(join(target, "animae.yaml"))) {
    process.stderr.write(`Refusing to overwrite existing data root: ${target}\n`);
    return 1;
  }

  if (opts.preset && !(await resolvePresetId(opts.preset))) {
    process.stderr.write(`Note: preset "${opts.preset}" is not registered yet (built-ins load from @animae/preset-base, @animae/preset-dnd and @animae/preset-rule).\n`);
  }

  await mkdir(target, { recursive: true });

  const presetLine = opts.preset ? `preset: ${JSON.stringify(opts.preset)}\n` : "";
  await writeFile(
    join(target, "animae.yaml"),
    `# Animae engine config (see docs/authoring-guide.md)
${presetLine}seed: 1
policies: []

# Models are optional: without them the engine plays on the rule backend (zero tokens, deterministic).
#   s1 = structured judgment (appraise, reflection, ...); s2 = free-text generation (render, offscreen, autonomous).
# models:
#   s1: { provider: anthropic, model: claude-haiku-4-5 }
#   s2:
#     default: std
#     tiers:
#       - { id: std, provider: anthropic, model: claude-sonnet-4-5 }
#       - { id: pro, provider: anthropic, model: claude-opus-4-5, tags: [premium] }
#     routing: { render: std, escalate_to: pro }
#
# mode: llm | hybrid | rule      # default: llm when models are configured, otherwise rule
# runtime:
#   switchAt: turn_boundary       # when \`animae --mode ...\` / :mode changes apply while a turn runs
`,
    "utf8",
  );

  await mkdir(join(target, "world", "locations"), { recursive: true });
  await mkdir(join(target, "world", "items"), { recursive: true });
  await mkdir(join(target, "world", "fields"), { recursive: true });
  await mkdir(join(target, "world", "knowledge"), { recursive: true });
  await mkdir(join(target, "characters", "player"), { recursive: true });
  await mkdir(join(target, "policies"), { recursive: true });
  await mkdir(join(target, "templates", "character"), { recursive: true });
  await mkdir(join(target, "templates", "location"), { recursive: true });
  await mkdir(join(target, "templates", "item"), { recursive: true });
  await mkdir(join(target, "timelines", "main", "snapshots"), { recursive: true });
  await mkdir(join(target, "timelines", "main", "entities"), { recursive: true });
  await mkdir(join(target, "timelines", "main", "artifacts"), { recursive: true });
  await mkdir(join(target, "derived"), { recursive: true });

  await writeFile(
    join(target, "world", "world.yaml"),
    `title: My World
language: en
start_location: home
player: player
calendar:
  sceneMinutes: 30
  turnMinutes: 1
vars: {}
public_vars: []
`,
    "utf8",
  );

  await writeFile(
    join(target, "world", "locations", "home.yaml"),
    `id: home
name: Home
summary: A quiet starting location.
tags: []
connects: []
vars: {}
`,
    "utf8",
  );

  await writeFile(
    join(target, "characters", "player", "card.md"),
    `---
identity:
  name: Player
  summary: The protagonist.
  style_examples: []
constraints:
  motives: []
  bottom_lines: []
  taboos: []
lod: principal
tags: []
---
You are the player character.
`,
    "utf8",
  );

  await writeFile(
    join(target, "characters", "player", "traits.yaml"),
    `event_mult: {}
`,
    "utf8",
  );

  await writeFile(
    join(target, "characters", "player", "tracks.yaml"),
    `{}`,
    "utf8",
  );

  await writeFile(
    join(target, "characters", "player", "goals.yaml"),
    `[]`,
    "utf8",
  );

  await writeFile(
    join(target, "characters", "player", "secrets.yaml"),
    `[]`,
    "utf8",
  );

  await writeFile(
    join(target, "characters", "player", "relations.yaml"),
    `[]`,
    "utf8",
  );

  await writeFile(join(target, "saves.yaml"), "slots: []\n", "utf8");
  await writeFile(
    join(target, "timelines", "main", "events.jsonl"),
    '{"kind":"branch.header","branch":"main"}\n',
    "utf8",
  );

  await writeFile(
    join(target, "policies", "README.md"),
    `# Policies

Add YAML or TypeScript policy documents here and list them in \`animae.yaml\`:

\`\`\`yaml
policies:
  - policies/my-tweaks.yaml
\`\`\`

Preset policies load automatically when \`preset:\` is set in animae.yaml.
`,
    "utf8",
  );

  process.stdout.write(`Initialized Animae data root at ${target}\n`);
  return 0;
}
