import { parseArgs } from "node:util";
import { RUNTIME_MODE_PRESETS, isRuntimeModePreset, type ModelMode, type RuntimeModePreset } from "@animae/engine";

export interface GlobalCliOptions {
  root: string;
  modelMode?: ModelMode;
  /** Runtime mode to start in: `full`, `judge-only`, `narrate-only` or `rule` (overrides `animae.yaml`). */
  mode?: RuntimeModePreset;
  seed?: number;
  /** BCP-47 UI locale (overrides env negotiation for engine-owned CLI/TUI output). */
  lang?: string;
  /** External ImagePort adapter executable (JSON stdin, image bytes stdout). */
  imageCommand?: string;
  imageCommandArgs?: string[];
  help?: boolean;
  version?: boolean;
}

export type ParsedCli =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "init"; dir: string; preset?: string; global: GlobalCliOptions }
  | { kind: "validate"; global: GlobalCliOptions; mods?: string[]; locale?: string; mode?: RuntimeModePreset }
  | { kind: "mods"; global: GlobalCliOptions; sub: "list" | "validate" | "explain"; path?: string; mods?: string[] }
  | { kind: "run"; global: GlobalCliOptions; scene?: string; withIds?: string[]; viewer?: string; theme?: string; plain?: boolean }
  | { kind: "inspect"; global: GlobalCliOptions; path: string; viewer?: string; eventKind?: string }
  | { kind: "timeline"; global: GlobalCliOptions; sub: string; rest: string[] }
  | { kind: "import-card"; global: GlobalCliOptions; file: string }
  | { kind: "export-card"; global: GlobalCliOptions; id: string }
  | { kind: "serve"; global: GlobalCliOptions; stdio: boolean }
  | { kind: "gallery"; global: GlobalCliOptions; sub: string; rest: string[]; json?: boolean }
  | { kind: "i18n"; global: GlobalCliOptions; sub: string; rest: string[] };

const COMMANDS = new Set([
  "init",
  "validate",
  "mods",
  "run",
  "inspect",
  "timeline",
  "import-card",
  "export-card",
  "serve",
  "gallery",
  "i18n",
  "help",
]);

const HELP = `animae — Animae engine CLI

Usage:
  animae [global flags] <command> [args]

Commands:
  init <dir> [--preset <id>]     Create a new data root skeleton
  validate [--mods a,b] [--locale <tag>] [--mode <mode>]
                                 Load and validate authored data + policy (+ mods, UI string tables);
                                 with --mode, also check the data root can play under that runtime mode
  mods list                      List mods under mods/
  mods validate [--mods a,b]     Validate mod manifests and dependency order
  mods explain <path>            Show which layer provided an authored path
  run [options]                  Interactive session (TUI or --plain)
  inspect <path> [--viewer <v>] [--kind <event kind>]
                                 Query engine state (--kind filters the \`events\` path)
  timeline <subcommand> ...      Timeline operations
  import-card <file>             Import a character card
  export-card <id>               Export a character card
  serve --stdio                  JSON-RPC sidecar on stdin/stdout
  gallery <sub> ...              Gallery list/show/capture/render (headless)
  i18n check [--pack <module>]|pseudo|extract
                                 Locale pack / prompt hygiene (--pack loads a locale pack module)

Global flags:
  --root <dir>                   Data root (default: cwd)
  --model-mode live|record|replay
  --mode full|judge-only|narrate-only|rule
                                 Runtime mode: which backend serves S1 (judgment) and S2 (text);
                                 \`rule\` plays with zero tokens (overrides animae.yaml)
  --seed <n>
  --lang <locale>                UI locale (BCP-47, e.g. en, fr, pt-BR)
  --image-command <path>         External ImagePort (JSON stdin, image stdout)
  --image-command-arg <arg>      Extra argv for --image-command (repeatable)
  --version
  --help
`;

export function helpText(): string {
  return HELP;
}

function splitCommand(argv: string[]): { globalArgv: string[]; command: string; rest: string[] } {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (COMMANDS.has(token)) {
      return { globalArgv: argv.slice(0, i), command: token, rest: argv.slice(i + 1) };
    }
  }
  return { globalArgv: argv, command: "", rest: [] };
}

const GLOBAL_FLAG_TOKENS = new Set([
  "--root",
  "--model-mode",
  "--mode",
  "--seed",
  "--lang",
  "--image-command",
  "--image-command-arg",
  "--version",
  "--help",
]);

/** Move global flags (and their values) out of a subcommand argument list. */
export function peelGlobalFlags(argv: string[]): { globalArgv: string[]; rest: string[] } {
  const globalArgv: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (
      t === "--root" ||
      t === "--model-mode" ||
      t === "--mode" ||
      t === "--seed" ||
      t === "--lang" ||
      t === "--image-command" ||
      t === "--image-command-arg"
    ) {
      globalArgv.push(t, argv[i + 1] ?? "");
      i++;
      continue;
    }
    if (GLOBAL_FLAG_TOKENS.has(t)) {
      globalArgv.push(t);
      continue;
    }
    rest.push(t);
  }
  return { globalArgv, rest };
}

function parseGlobalPartial(argv: string[]): Omit<GlobalCliOptions, "root"> & { root?: string } {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: "string" },
      "model-mode": { type: "string" },
      mode: { type: "string" },
      seed: { type: "string" },
      lang: { type: "string" },
      "image-command": { type: "string" },
      "image-command-arg": { type: "string", multiple: true },
      version: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: false,
  });

  const modelMode = values["model-mode"] as ModelMode | undefined;
  if (modelMode && !["live", "record", "replay"].includes(modelMode)) {
    throw new Error(`Invalid --model-mode: ${modelMode}`);
  }

  const modeRaw = values.mode as string | undefined;
  if (modeRaw !== undefined && !isRuntimeModePreset(modeRaw)) {
    throw new Error(`Invalid --mode: ${modeRaw} (expected ${RUNTIME_MODE_PRESETS.join(", ")})`);
  }
  const mode = modeRaw as RuntimeModePreset | undefined;

  const seedRaw = values.seed;
  const seed = seedRaw !== undefined ? Number(seedRaw) : undefined;
  if (seedRaw !== undefined && !Number.isFinite(seed)) {
    throw new Error(`Invalid --seed: ${seedRaw}`);
  }

  const imageCommandArgs = values["image-command-arg"] as string[] | undefined;

  return {
    root: values.root as string | undefined,
    modelMode,
    mode,
    seed,
    lang: values.lang as string | undefined,
    imageCommand: values["image-command"] as string | undefined,
    imageCommandArgs: imageCommandArgs?.length ? imageCommandArgs : undefined,
    help: values.help as boolean,
    version: values.version as boolean,
  };
}

function finalizeGlobal(p: Omit<GlobalCliOptions, "root"> & { root?: string }): GlobalCliOptions {
  return { ...p, root: p.root ?? process.cwd() };
}

function parseGlobal(argv: string[]): GlobalCliOptions {
  return finalizeGlobal(parseGlobalPartial(argv));
}

export function parseCli(argv: string[]): ParsedCli {
  const { globalArgv, command, rest: restRaw } = splitCommand(argv);
  const peeled = peelGlobalFlags(restRaw);
  const global = parseGlobal([...globalArgv, ...peeled.globalArgv]);
  const rest = peeled.rest;

  if (global.version) return { kind: "version" };
  if (global.help && !command) return { kind: "help" };
  if (!command || command === "help") return { kind: "help" };

  switch (command) {
    case "init": {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { preset: { type: "string" } },
        allowPositionals: true,
      });
      const dir = positionals[0];
      if (!dir) throw new Error("init requires <dir>");
      return { kind: "init", dir, preset: values.preset as string | undefined, global };
    }
    case "validate": {
      const { values } = parseArgs({
        args: rest,
        options: { mods: { type: "string" }, locale: { type: "string" } },
        allowPositionals: true,
      });
      const modsRaw = values.mods as string | undefined;
      const mods = modsRaw?.split(",").map((s) => s.trim()).filter(Boolean);
      const locale = (values.locale as string | undefined) ?? global.lang;
      return {
        kind: "validate",
        global,
        mods: mods?.length ? mods : undefined,
        locale,
        mode: global.mode,
      };
    }
    case "mods": {
      const sub = rest[0] as "list" | "validate" | "explain" | undefined;
      if (!sub || !["list", "validate", "explain"].includes(sub)) {
        throw new Error("mods requires subcommand: list | validate | explain");
      }
      const tail = rest.slice(1);
      const { values, positionals } = parseArgs({
        args: tail,
        options: { mods: { type: "string" }, root: { type: "string" } },
        allowPositionals: true,
      });
      const modsRaw = values.mods as string | undefined;
      const mods = modsRaw?.split(",").map((s) => s.trim()).filter(Boolean);
      if (sub === "explain") {
        const path = positionals[0];
        if (!path) throw new Error("mods explain requires <path>");
        return { kind: "mods", global, sub, path, mods: mods?.length ? mods : undefined };
      }
      return { kind: "mods", global, sub, mods: mods?.length ? mods : undefined };
    }
    case "run": {
      const { values } = parseArgs({
        args: rest,
        options: {
          scene: { type: "string" },
          with: { type: "string", multiple: true },
          viewer: { type: "string" },
          theme: { type: "string" },
          plain: { type: "boolean", default: false },
        },
        allowPositionals: true,
      });
      return {
        kind: "run",
        global,
        scene: values.scene as string | undefined,
        withIds: values.with as string[] | undefined,
        viewer: values.viewer as string | undefined,
        theme: values.theme as string | undefined,
        plain: values.plain as boolean,
      };
    }
    case "inspect": {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { viewer: { type: "string" }, kind: { type: "string" } },
        allowPositionals: true,
      });
      const path = positionals[0];
      if (!path) throw new Error("inspect requires <path>");
      const eventKind = values.kind as string | undefined;
      if (eventKind !== undefined && path !== "events") {
        throw new Error("--kind filters the `events` path: use `animae inspect events --kind <event kind>`");
      }
      return { kind: "inspect", global, path, viewer: values.viewer as string | undefined, eventKind };
    }
    case "timeline": {
      const sub = rest[0];
      if (!sub) throw new Error("timeline requires a subcommand");
      return { kind: "timeline", global, sub, rest: rest.slice(1) };
    }
    case "import-card": {
      const file = rest[0];
      if (!file) throw new Error("import-card requires <file>");
      return { kind: "import-card", global, file };
    }
    case "export-card": {
      const id = rest[0];
      if (!id) throw new Error("export-card requires <id>");
      return { kind: "export-card", global, id };
    }
    case "serve": {
      const { values } = parseArgs({
        args: rest,
        options: { stdio: { type: "boolean", default: false } },
        allowPositionals: true,
      });
      if (!values.stdio) throw new Error("serve requires --stdio");
      return { kind: "serve", global, stdio: true };
    }
    case "gallery": {
      const sub = rest[0];
      if (!sub) throw new Error("gallery requires a subcommand (list|show|capture|render|cancel|remove|pin|ratings|jobs)");
      const tail = rest.slice(1);
      const { values } = parseArgs({
        args: tail,
        options: { json: { type: "boolean", default: false } },
        allowPositionals: true,
      });
      return {
        kind: "gallery",
        global,
        sub,
        rest: tail,
        json: values.json as boolean,
      };
    }
    case "i18n": {
      const sub = rest[0] ?? "check";
      return { kind: "i18n", global, sub, rest: rest.slice(1) };
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}
