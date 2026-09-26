import { createInterface } from "node:readline";
import { createRpcServer } from "@animae/engine";
import { printError } from "../errors.ts";
import { openEngine, type OpenEngineOptions } from "../engine-open.ts";
import { createCommandImagePort } from "../image-command-port.ts";

export async function runServe(
  opts: OpenEngineOptions & { stdio: boolean; imageCommand?: string; imageCommandArgs?: string[] },
): Promise<number> {
  if (!opts.stdio) {
    process.stderr.write("serve currently supports only --stdio\n");
    return 1;
  }

  let engine;
  try {
    const ports = opts.imageCommand
      ? { image: createCommandImagePort({ command: opts.imageCommand, args: opts.imageCommandArgs }) }
      : opts.ports;
    engine = await openEngine({ ...opts, ports });
  } catch (err) {
    printError(err);
    return 1;
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const read = (async function* () {
    for await (const line of rl) yield line;
  })();

  const server = createRpcServer(engine, {
    read,
    write(line: string) {
      process.stdout.write(line);
    },
  });

  const onSignal = () => {
    server.close();
    rl.close();
  };
  process.stdin.on("close", onSignal);

  try {
    await server.run();
    return 0;
  } catch (err) {
    printError(err, process.stderr);
    return 1;
  } finally {
    await engine.close();
  }
}

/** Test helper: serve over arbitrary streams. */
export function createStdioRpcSession(
  engine: Awaited<ReturnType<typeof openEngine>>,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): { run(): Promise<void>; close(): void } {
  const rl = createInterface({ input, crlfDelay: Infinity });
  const read = (async function* () {
    for await (const line of rl) yield line;
  })();
  return createRpcServer(engine, {
    read,
    write(line: string) {
      output.write(line);
    },
  });
}
