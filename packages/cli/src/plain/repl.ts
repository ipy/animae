import { createInterface } from "node:readline";
import type { Engine, SceneId, Viewer } from "@animae/engine";
import { createCliI18n } from "../i18n/cli-i18n.ts";
import { ChunkPrinter } from "./chunk-printer.ts";
import { runColonCommand } from "./colon-commands.ts";

export interface PlainReplOptions {
  engine: Engine;
  sceneId: SceneId;
  actor?: string;
  viewer?: Viewer;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** BCP-47 UI locale for REPL messages (default: negotiate from env). */
  locale?: string;
}

export async function runPlainRepl(opts: PlainReplOptions): Promise<number> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const actor = opts.actor ?? "player";
  const viewer = opts.viewer ?? "player";
  const i18n = createCliI18n(opts.locale);

  const api = {
    engine: opts.engine,
    viewer,
    locale: opts.locale,
    notify(msg: string) {
      output.write(`${msg}\n`);
    },
  };

  output.write("Plain mode — type dialogue or :help. Ctrl+D to quit.\n");

  const rl = createInterface({ input, output, terminal: input === process.stdin });
  /** The input ended or was closed: nothing more to prompt for. */
  let closed = false;
  /** `:quit` was entered: lines already read after it are not run. */
  let quit = false;

  const prompt = () => {
    if (!closed) rl.prompt();
  };

  rl.setPrompt("> ");

  await new Promise<void>((resolve) => {
    const handle = async (line: string): Promise<void> => {
      // Lines after :quit (a piped script) are not run.
      if (quit) return;
      const trimmed = line.trim();
      if (!trimmed) {
        prompt();
        return;
      }
      try {
        if (trimmed.startsWith(":")) {
          const result = await runColonCommand(trimmed, api);
          if (result === "quit") {
            quit = true;
            closed = true;
            rl.close();
            return;
          }
          prompt();
          return;
        }

        const printer = new ChunkPrinter(output, {
          resetNotice: (reason) => i18n.t("plain.reset", { reason }, { ns: "cli" }),
        });
        try {
          for await (const chunk of opts.engine.scene.turn({ sceneId: opts.sceneId, actor, text: trimmed })) {
            printer.write(chunk);
          }
        } finally {
          printer.finish();
        }
      } catch (err) {
        output.write(`${err instanceof Error ? err.message : String(err)}\n`);
      }
      prompt();
    };

    // One line at a time, in order: a piped script must not quit, or start its next turn, while an earlier turn is
    // still running; and the REPL only returns once the last line has been handled.
    let queue: Promise<void> = Promise.resolve();
    rl.on("line", (line) => {
      queue = queue.then(() => handle(line));
    });
    rl.on("close", () => {
      closed = true;
      void queue.then(resolve);
    });
    prompt();
  });

  return 0;
}
