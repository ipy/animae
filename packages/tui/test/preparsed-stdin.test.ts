import { test, expect } from "bun:test";
import { Readable } from "node:stream";
import { createPreparsedStdin } from "../src/input/preparsed-stdin.ts";
import { parseKeypress } from "../src/ink/parse-keypress.ts";

class MockTtyIn extends Readable {
  isTTY = true;
  setRawMode(_mode: boolean): void {}
  override _read(): void {}
}

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function busyMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* simulate main-thread stall */
  }
}

async function collectOutput(setup: (tty: MockTtyIn) => void): Promise<string[]> {
  const tty = new MockTtyIn();
  const { stream, dispose } = createPreparsedStdin(tty);
  const out: string[] = [];
  stream.on("data", (chunk: Buffer | string) => {
    out.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });
  setup(tty);
  await waitMs(80);
  dispose();
  await waitMs(5);
  return out;
}

test("preparsed stdin reassembles SS3 F1 split at every byte with 100ms stall", async () => {
  const seq = "\x1bOP";
  const out = await collectOutput((tty) => {
    for (let i = 0; i < seq.length; i++) {
      tty.push(seq[i]!);
      if (i < seq.length - 1) busyMs(100);
    }
  });
  const joined = out.join("");
  expect(joined).toBe(seq);
  expect(parseKeypress(joined).name).toBe("f1");
});

test("preparsed stdin reassembles CSI F1 split across chunks", async () => {
  const seq = "\x1b[11~";
  const out = await collectOutput((tty) => {
    tty.push(seq.slice(0, 2));
    busyMs(100);
    tty.push(seq.slice(2));
  });
  expect(out.join("")).toBe(seq);
  expect(parseKeypress(out.join("")).name).toBe("f1");
});

test("preparsed stdin preserves UTF-8 CJK split across byte boundaries", async () => {
  const text = "你好";
  const bytes = Buffer.from(text, "utf8");
  const out = await collectOutput((tty) => {
    tty.push(bytes.subarray(0, 1));
    busyMs(30);
    tty.push(bytes.subarray(1));
  });
  expect(out.join("")).toBe(text);
});

test("preparsed stdin forwards bracketed paste as one frame", async () => {
  const paste = "\x1b[200~hello\nworld\x1b[201~";
  const out = await collectOutput((tty) => {
    tty.push(paste);
  });
  expect(out.join("")).toBe(paste);
});

test("preparsed stdin lone Esc after timeout", async () => {
  const out = await collectOutput((tty) => {
    tty.push("\x1b");
  });
  expect(out.join("")).toBe("\x1b");
  expect(parseKeypress(out.join("")).name).toBe("escape");
});
