import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "bun:test";
import { buildHandlerMap } from "../../src/rpc/dispatch.ts";
import { createFakeEngine } from "./fake-engine.ts";

const SERVER_ONLY = new Set(["subscribe", "unsubscribe"]);
const BLOCKED = new Set(["rules.register", "hooks.register", "introspect.registerViewer", "close"]);

function handlerKeys(): string[] {
  const map = buildHandlerMap(createFakeEngine(), {
    turnMutex: { run: (fn) => fn() },
    replayMutex: { run: (fn) => fn() },
    onStreamChunk: () => {},
  });
  return [...map.keys()].sort();
}

function parseRpcReferenceMethods(markdown: string): string[] {
  const methods = new Set<string>();
  for (const line of markdown.split("\n")) {
    const m = /^\|\s*`([a-zA-Z0-9_.]+)`\s*\|/.exec(line);
    if (!m) continue;
    const name = m[1]!;
    if (name === "turn.chunk" || name === "event" || name === "gallery.notice") continue;
    methods.add(name);
  }
  return [...methods].sort();
}

test("rpc-reference.md lists every buildHandlerMap method plus subscribe/unsubscribe", async () => {
  const docPath = join(import.meta.dirname, "../../../../docs/rpc-reference.md");
  const md = await readFile(docPath, "utf8");
  const documented = parseRpcReferenceMethods(md);
  const implemented = handlerKeys();
  const expected = [...implemented, ...SERVER_ONLY].sort();

  expect(documented).toEqual(expected);
  for (const blocked of BLOCKED) {
    expect(implemented).not.toContain(blocked);
    expect(documented).not.toContain(blocked);
  }
});

test("RPC entity.setAlias params mirror Engine.entities.setAlias(input)", () => {
  expect(handlerKeys()).toContain("entities.setAlias");
  expect(handlerKeys()).toContain("entities.spawn");
  expect(handlerKeys()).toContain("entities.generateFromBrief");
  expect(handlerKeys()).toContain("setUiLocale");
  expect(handlerKeys()).toContain("display.resolve");
  expect(handlerKeys()).toContain("mods");
});
