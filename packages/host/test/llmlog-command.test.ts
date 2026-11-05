import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createModelCallLog, createScriptedModel, withModelCallLog } from "@animae/engine";
import { runLlmlogCommand } from "../src/llmlog-command.ts";
import type { HostCommandApi } from "../src/types.ts";

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length) await rm(cleanups.pop()!, { recursive: true, force: true });
});

function api(overrides: Partial<HostCommandApi> & { log?: ReturnType<typeof createModelCallLog>; root?: string }): HostCommandApi {
  const notes: Array<{ text: string; level?: string }> = [];
  const root = overrides.root ?? "/mem";
  const log = overrides.log;
  return {
    engine: {
      modelCallLog: log,
      info: () => ({ root }),
    } as HostCommandApi["engine"],
    viewer: "player",
    actor: "player",
    sceneId: () => undefined,
    startScene: async () => "s",
    endScene: async () => {},
    notify: (text, level) => {
      notes.push({ text: String(text), level });
    },
    openOverlay: () => {},
    closeOverlay: () => {},
    setMouseCapture: () => {},
    locale: () => "en",
    t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k),
    ...overrides,
  };
}

async function seedLog() {
  const log = createModelCallLog();
  const schema = z.object({ text: z.string() });
  const port = withModelCallLog(createScriptedModel("stub", () => ({ text: "ok" })), { slot: "s2", log });
  await port.object({
    label: "render",
    segments: { static: "sys", semiStatic: "", dynamic: "", user: "hi" },
    maxOutputTokens: 16,
    schema,
  });
  return log;
}

describe("runLlmlogCommand", () => {
  test("warns when model call log is disabled", async () => {
    const notes: string[] = [];
    const out = await runLlmlogCommand([], api({ notify: (t, l) => notes.push(`${l}:${t}`) }));
    expect(out).toBeUndefined();
    expect(notes.some((n) => n.includes("command.llmlog_disabled"))).toBe(true);
  });

  test("lists recent entries with token summary", async () => {
    const log = await seedLog();
    const out = await runLlmlogCommand([], api({ log }));
    expect(out).toContain("render");
    expect(out).toContain("S2");
  });

  test("dump writes jsonl under engine root", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-llmlog-"));
    cleanups.push(root);
    const log = await seedLog();
    const out = await runLlmlogCommand(["dump"], api({ log, root }));
    expect(out).toContain("command.llmlog_dumped");
    expect(out).toContain("llm-log");
  });

  test("shows a single entry by sequence number", async () => {
    const log = await seedLog();
    const rows = log.list({ limit: 1 });
    const seq = rows[0]!.seq;
    const out = await runLlmlogCommand([String(seq)], api({ log }));
    expect(out).toContain("[user]");
    expect(out).toContain("hi");
    expect(out).toContain("---");
  });

  test("warns when sequence is missing", async () => {
    const log = await seedLog();
    const notes: string[] = [];
    await runLlmlogCommand(["9999"], api({ log, notify: (t) => notes.push(String(t)) }));
    expect(notes.some((n) => n.includes("command.llmlog_not_found"))).toBe(true);
  });

  test("empty log returns empty message key", async () => {
    const log = createModelCallLog();
    const out = await runLlmlogCommand([], api({ log }));
    expect(out).toBe("command.llmlog_empty");
  });
});
