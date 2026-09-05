import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test, expect } from "bun:test";
import { createEngine, createScriptedModel } from "@animae/engine";
import { runInit } from "../src/commands/init.ts";
import { runColonCommand } from "../src/plain/colon-commands.ts";
import { runPlainRepl } from "../src/plain/repl.ts";

test("colon :help and :branches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-plain-"));
  try {
    await runInit({ dir });
    const model = createScriptedModel("test/s1", () => ({ text: "ok" }));
    const engine = await createEngine({ root: dir, models: { s1: model, s2: model }, presets: [] });
    const lines: string[] = [];
    await runColonCommand(":help", {
      engine,
      viewer: "player",
      notify: (m) => lines.push(m),
    });
    expect(lines[0]).toContain(":save");
    await engine.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("plain repl reads stdin script", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-plain-r-"));
  try {
    await runInit({ dir });
    const model = createScriptedModel("test/s1", () => ({ text: "hello" }));
    const engine = await createEngine({ root: dir, models: { s1: model, s2: model }, presets: [] });
    const sceneId = await engine.scene.start({ location: "home", participants: ["player"] });
    const input = Readable.from([":help\n", ":quit\n"]);
    const out: string[] = [];
    const output = { write(s: string) { out.push(s); return true; } } as NodeJS.WritableStream;
    await runPlainRepl({ engine, sceneId, input, output });
    expect(out.some((l) => l.includes(":save"))).toBe(true);
    await engine.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
