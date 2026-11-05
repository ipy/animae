import { describe, expect, test } from "bun:test";
import { hostBuiltinCommands, runHostCommandLine } from "../src/builtin-commands.ts";
import type { HostCommand } from "../src/types.ts";
import { createHostCommandApiStub } from "./helpers/host-command-api-stub.ts";

describe("hostBuiltinCommands", () => {
  test("help notifies a localized line", async () => {
    const api = createHostCommandApiStub();
    await hostBuiltinCommands.help!.run([], api);
    expect(api.notes.length).toBe(1);
  });

  test("save and load with slot", async () => {
    const api = createHostCommandApiStub();
    await hostBuiltinCommands.save!.run(["slot-a"], api);
    expect(api.notes.some((n) => n.includes("slot-a") || n.includes("command.saved"))).toBe(true);
    await hostBuiltinCommands.load!.run(["slot-a"], api);
    expect(api.notes.some((n) => n.includes("command.loaded"))).toBe(true);
  });

  test("load without slot opens overlay", async () => {
    const api = createHostCommandApiStub();
    await hostBuiltinCommands.load!.run([], api);
    expect(api.overlays).toEqual(["loadSlots"]);
  });

  test("rewind requires event id", async () => {
    const api = createHostCommandApiStub();
    await hostBuiltinCommands.rewind!.run([], api);
    expect(api.notes.some((n) => n.includes("rewind_usage"))).toBe(true);
    await hostBuiltinCommands.rewind!.run(["ev_9"], api);
    expect(api.notes.some((n) => n.includes("rewound"))).toBe(true);
  });

  test("branches lists names or none", async () => {
    const api = createHostCommandApiStub();
    const out = await hostBuiltinCommands.branches!.run([], api);
    expect(out).toBe("main, alt");
    const empty = createHostCommandApiStub({ enginePatch: { timeline: { branches: async () => [] } } });
    const none = await hostBuiltinCommands.branches!.run([], empty);
    expect(none).toBe("command.branches_none");
  });

  test("explain opens overlay or returns chain json", async () => {
    const api = createHostCommandApiStub();
    await hostBuiltinCommands.explain!.run([], api);
    expect(api.overlays).toContain("explain");
    const out = await hostBuiltinCommands.explain!.run(["turn_1"], api);
    expect(out).toBe(JSON.stringify(["step"]));
  });

  test("query validates args and stringifies result", async () => {
    const api = createHostCommandApiStub();
    await hostBuiltinCommands.query!.run(["player"], api);
    expect(api.notes.some((n) => n.includes("query_usage"))).toBe(true);
    const out = await hostBuiltinCommands.query!.run(["player", "world/vars/x"], api);
    expect(out).toBe("42");
  });

  test("advance requires duration", async () => {
    const api = createHostCommandApiStub();
    await hostBuiltinCommands.advance!.run([], api);
    expect(api.notes.some((n) => n.includes("advance_usage"))).toBe(true);
    await hostBuiltinCommands.advance!.run(["1", "hour"], api);
    expect(api.notes.some((n) => n.includes("advanced"))).toBe(true);
  });
});

describe("runHostCommandLine", () => {
  test("parses quoted args and dispatches custom commands", async () => {
    const api = createHostCommandApiStub();
    const extra: Record<string, HostCommand> = {
      echo: { description: "echo", run: async (args) => args.join("|") },
    };
    await runHostCommandLine(':echo "hello world" tail', api, extra);
    expect(api.notes.at(-1)).toBe("hello world|tail");
  });

  test("unknown command warns", async () => {
    const api = createHostCommandApiStub();
    await runHostCommandLine(":nope", api, {});
    expect(api.notes.some((n) => n.includes("unknown"))).toBe(true);
  });

  test("ignores non-colon lines", async () => {
    const api = createHostCommandApiStub();
    await runHostCommandLine("plain text", api, {});
    expect(api.notes).toHaveLength(0);
  });
});
