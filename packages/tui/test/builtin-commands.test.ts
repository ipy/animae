import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createModelCallLog, createScriptedModel, withModelCallLog } from "@animae/engine";
import { builtinCommands, runCommandLine } from "../src/commands/builtin.ts";
import { subscribeQueryChanges } from "../src/utils/engine-events.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import type { CommandApi, CustomCommand } from "../src/types.ts";
import { createTestCommandApi } from "./helpers/command-api-test.ts";

function api(overrides: Partial<CommandApi> = {}, engine = createTuiFakeEngine()) {
  return createTestCommandApi(overrides, engine);
}

describe("builtin commands", () => {
  test("save and load with label", async () => {
    const { api: a, notes } = api();
    await builtinCommands.save!.run(["slot-a"], a);
    expect(notes[0]?.text).toContain("command.saved");
    await builtinCommands.load!.run(["slot-a"], a);
    expect(notes[1]?.text).toContain("command.loaded");
  });

  test("load without args opens overlay", async () => {
    let opened: string | undefined;
    const { api: a } = api({ openOverlay: (k) => (opened = k) });
    await builtinCommands.load!.run([], a);
    expect(opened).toBe("loadSlots");
  });

  test("rewind warns without id and rewinds with id", async () => {
    const { api: a, notes } = api();
    await builtinCommands.rewind!.run([], a);
    expect(notes[0]?.level).toBe("warn");
    await builtinCommands.rewind!.run(["evt_9"], a);
    expect(notes[1]?.text).toContain("evt_9");
  });

  test("load and rewind tell the query hooks that the timeline moved, so the panels show the new branch", async () => {
    const engine = createTuiFakeEngine();
    const { api: a } = api({}, engine);
    let refreshes = 0;
    const off = subscribeQueryChanges(engine, () => {
      refreshes += 1;
    });
    await builtinCommands.load!.run(["slot-a"], a);
    expect(refreshes).toBe(1);
    await builtinCommands.rewind!.run(["evt_9"], a);
    expect(refreshes).toBe(2);
    await builtinCommands.rewind!.run([], a); // no event id: nothing moved
    await builtinCommands.load!.run([], a); // opens the list: nothing moved yet
    expect(refreshes).toBe(2);
    off();
  });

  test("branches lists names or empty message", async () => {
    const { api: a, notes } = api();
    const out = await builtinCommands.branches!.run([], a);
    expect(out).toBeUndefined();
    expect(notes[0]?.text).toContain("main");
  });

  test("explain opens overlay or prints chain", async () => {
    let opened: string | undefined;
    const { api: a, notes } = api({ openOverlay: (k) => (opened = k) });
    await builtinCommands.explain!.run([], a);
    expect(opened).toBe("explain");
    await builtinCommands.explain!.run(["turn_0001"], a);
    expect(notes.at(-1)?.text).toContain(" spoke");
  });

  test("query uses queryAsync for player viewer", async () => {
    let asyncPath: string | undefined;
    const engine = createTuiFakeEngine({
      queryAsync: async (_v, path) => {
        asyncPath = path;
        return { ok: true };
      },
    });
    const { api: a } = api({ engine }, engine);
    const out = await builtinCommands.query!.run(["player", "world/time"], a);
    expect(asyncPath).toBe("world/time");
    expect(out).toContain('"ok": true');
    const { api: warnApi, notes: warnNotes } = api();
    await builtinCommands.query!.run(["player"], warnApi);
    expect(warnNotes[0]?.level).toBe("warn");
  });

  test("advance requires duration", async () => {
    const { api: a, notes } = api();
    await builtinCommands.advance!.run([], a);
    expect(notes[0]?.level).toBe("warn");
    await builtinCommands.advance!.run(["2h"], a);
    expect(notes[1]?.text).toContain("2h");
  });

  test("lang sets locale when provided", async () => {
    let loc: string | undefined;
    const { api: a, notes } = api({ setUiLocale: (l) => (loc = l) });
    await builtinCommands.lang!.run([], a);
    expect(notes[0]?.level).toBe("warn");
    await builtinCommands.lang!.run(["fr"], a);
    expect(loc).toBe("fr");
  });

  test("mouse on/off/status", async () => {
    let capture: boolean | undefined;
    const { api: a } = api({ setMouseCapture: (v) => (capture = v) });
    expect(await builtinCommands.mouse!.run(["on"], a)).toBe("command.mouse_on");
    expect(capture).toBe(true);
    expect(await builtinCommands.mouse!.run(["off"], a)).toBe("command.mouse_off");
    expect(await builtinCommands.mouse!.run([], a)).toBe("command.mouse_usage");
  });

  test("llmlog disabled, dump, seq, and list", async () => {
    const disabledEngine = createTuiFakeEngine({ modelCallLog: undefined as never });
    const { api: disabled, notes: disabledNotes } = api({ engine: disabledEngine }, disabledEngine);
    await builtinCommands.llmlog!.run([], disabled);
    expect(disabledNotes[0]?.level).toBe("warn");

    const log = createModelCallLog();
    const schema = z.object({ text: z.string() });
    const port = withModelCallLog(createScriptedModel("m", () => ({ text: "x" })), { slot: "s1", log });
    await port.object({
      label: "appraise",
      segments: { static: "a", semiStatic: "", dynamic: "", user: "u" },
      maxOutputTokens: 8,
      schema,
    });
    const logEngine = createTuiFakeEngine({ modelCallLog: log });
    const { api: a, notes } = api({ engine: logEngine }, logEngine);
    const listed = await builtinCommands.llmlog!.run([], a);
    expect(listed).toContain("appraise");
    const dumped = await builtinCommands.llmlog!.run(["dump"], a);
    expect(dumped).toContain("command.llmlog_dumped");
    const detail = await builtinCommands.llmlog!.run(["1"], a);
    expect(detail).toContain("[user]");
    await builtinCommands.llmlog!.run(["999"], a);
    expect(notes.at(-1)?.level).toBe("warn");
  });

  test("runCommandLine parses quotes and unknown commands", async () => {
    const { api: a, notes } = api();
    await runCommandLine(':save "my slot"', a, {});
    expect(notes[0]?.text).toContain("my slot");
    expect(notes[0]?.text).toContain("command.saved");
    await runCommandLine(":nope", a, {});
    expect(notes[1]?.level).toBe("warn");
    const quit = await runCommandLine(":quit", a, {});
    expect(quit).toBe("quit");
  });

  test("runCommandLine runs custom command and localizes errors", async () => {
    const { api: a, notes } = api();
    const boom: CustomCommand = {
      description: "x",
      run: async () => {
        throw new Error("fail");
      },
    };
    await runCommandLine(":boom", a, { boom });
    expect(notes[0]?.level).toBe("warn");
  });
});
