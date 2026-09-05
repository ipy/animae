export function memoryDuplex(): {
  read: AsyncIterable<string>;
  write: (line: string) => void;
  written: string[];
  push: (line: string) => void;
  close: () => void;
} {
  const written: string[] = [];
  const queue: string[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const wait = () =>
    new Promise<void>((r) => {
      if (queue.length || done) r();
      else resolve = r;
    });

  async function* gen(): AsyncGenerator<string> {
    while (!done || queue.length) {
      if (!queue.length) await wait();
      while (queue.length) yield queue.shift()!;
    }
  }

  return {
    read: gen(),
    write(line: string) {
      written.push(line);
    },
    written,
    push(line: string) {
      queue.push(line.endsWith("\n") ? line : `${line}\n`);
      resolve?.();
      resolve = null;
    },
    close() {
      done = true;
      resolve?.();
      resolve = null;
    },
  };
}
