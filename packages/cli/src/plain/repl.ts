import { createInterface } from "node:readline";
import type { Engine, SceneId, TurnChunk, Viewer } from "@animae/engine";
import { runColonCommand } from "./colon-commands.ts";

export interface PlainReplOptions {
  engine: Engine;
  sceneId: SceneId;
  actor?: string;
  viewer?: Viewer;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

function formatChunk(chunk: TurnChunk, output: NodeJS.WritableStream): void {
  if (chunk.type === "text") {
    const prefix = chunk.speaker ? `${chunk.speaker}: ` : "";
    output.write(`${prefix}${chunk.text}\n`);
  } else if (chunk.type === "cue") {
    const name = typeof chunk.cue.args.name === "string" ? chunk.cue.args.name : JSON.stringify(chunk.cue.args);
    output.write(`[${chunk.cue.type}: ${name}]\n`);
  } else if (chunk.type === "choices") {
    for (const [i, c] of chunk.choices.entries()) {
      output.write(`  ${i + 1}. ${c.text}\n`);
    }
  }
}

export async function runPlainRepl(opts: PlainReplOptions): Promise<number> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const actor = opts.actor ?? "player";
  const viewer = opts.viewer ?? "player";

  const api = {
    engine: opts.engine,
    viewer,
    notify(msg: string) {
      output.write(`${msg}\n`);
    },
  };

  output.write("Plain mode — type dialogue or :help. Ctrl+D to quit.\n");

  const rl = createInterface({ input, output, terminal: input === process.stdin });
  let closed = false;

  const prompt = () => {
    if (!closed) rl.prompt();
  };

  rl.setPrompt("> ");

  await new Promise<void>((resolve) => {
    rl.on("line", (line) => {
      void (async () => {
        const trimmed = line.trim();
        if (!trimmed) {
          prompt();
          return;
        }
        if (trimmed.startsWith(":")) {
          const quit = await runColonCommand(trimmed, api);
          if (quit === "quit") {
            closed = true;
            rl.close();
            resolve();
            return;
          }
          prompt();
          return;
        }

        try {
          for await (const chunk of opts.engine.scene.turn({
            sceneId: opts.sceneId,
            actor,
            text: trimmed,
          })) {
            formatChunk(chunk, output);
          }
        } catch (err) {
          output.write(`${err instanceof Error ? err.message : String(err)}\n`);
        }
        prompt();
      })();
    });
    rl.on("close", () => {
      closed = true;
      resolve();
    });
    prompt();
  });

  return 0;
}
