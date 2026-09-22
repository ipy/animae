import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createModelCallLog, createScriptedModel, withModelCallLog } from "@animae/engine";
import { builtinCommands } from "../src/commands/builtin.ts";
import type { CommandApi } from "../src/types.ts";

describe(":llmlog command", () => {
  test("lists recent entries", async () => {
    const log = createModelCallLog();
    const schema = z.object({ text: z.string() });
    const port = withModelCallLog(createScriptedModel("m", () => ({ text: "x" })), { slot: "s1", log });
    await port.object({
      label: "appraise",
      segments: { static: "a", semiStatic: "", dynamic: "", user: "u" },
      maxOutputTokens: 8,
      schema,
    });
    const api = {
      engine: {
        modelCallLog: log,
        info: () => ({ root: "/tmp/test-root" }),
      },
      notify: () => {},
      t: (k: string) => k,
    } as unknown as CommandApi;
    const out = await builtinCommands.llmlog!.run([], api);
    expect(typeof out).toBe("string");
    expect(out).toContain("appraise");
  });
});
