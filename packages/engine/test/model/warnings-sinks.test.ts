import { describe, expect, test, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createFileModelWarningSink,
  createMemoryModelWarningSink,
  estimatePromptTokensFromChars,
  fileModelWarningSink,
  installAiSdkWarningHandler,
  registerModelWarningSink,
  resetModelWarningState,
  warnMissingApiKey,
  warnOllamaContextBudget,
} from "../../src/model/warnings.ts";

type AiSdkLogPayload = {
  warnings: { type: string; feature?: string; details?: string; setting?: string; message?: string }[];
  provider?: string;
  model?: string;
};

function callAiSdkWarnings(payload: AiSdkLogPayload): void {
  const fn = globalThis.AI_SDK_LOG_WARNINGS;
  if (typeof fn !== "function") throw new Error("AI_SDK_LOG_WARNINGS is not installed");
  fn(payload as Parameters<typeof fn>[0]);
}

afterEach(() => resetModelWarningState());

describe("model warning sinks", () => {
  test("AI SDK handler formats warning types and dedupes globally", () => {
    const seen: string[] = [];
    registerModelWarningSink((e) => seen.push(e.message));
    installAiSdkWarningHandler();
    callAiSdkWarnings({
      provider: "openai",
      model: "gpt-test",
      warnings: [
        { type: "unsupported", feature: "tools", details: "not available" },
        { type: "compatibility", feature: "stream" },
        { type: "deprecated", setting: "maxTokens", message: "use max_tokens" },
        { type: "other", message: "misc" },
        { type: "unknown_kind" as "other", message: "x" },
      ],
    });
    callAiSdkWarnings({
      warnings: [{ type: "other", message: "misc" }],
    });
    expect(seen.length).toBe(6);
    expect(seen[0]).toContain("tools");
    expect(seen[0]).toContain("(openai / gpt-test)");
  });

  test("sink errors do not propagate", () => {
    registerModelWarningSink(() => {
      throw new Error("sink broke");
    });
    installAiSdkWarningHandler();
    expect(() =>
      callAiSdkWarnings({ warnings: [{ type: "other", message: "ok" }] }),
    ).not.toThrow();
  });

  test("unregister removes sink", () => {
    const store: string[] = [];
    const off = registerModelWarningSink((e) => store.push(e.message));
    installAiSdkWarningHandler();
    callAiSdkWarnings({ warnings: [{ type: "other", message: "a" }] });
    off();
    callAiSdkWarnings({ warnings: [{ type: "other", message: "b" }] });
    expect(store).toEqual([expect.stringContaining("a")]);
  });

  test("file sink appends lines; fileModelWarningSink registers once per path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-warn-"));
    try {
      const logPath = join(dir, "nested", "warn.log");
      const sink = createFileModelWarningSink(logPath);
      sink({ message: "first line" });
      sink({ message: "second line" });
      await new Promise((r) => setTimeout(r, 50));
      const text = await readFile(logPath, "utf8");
      expect(text).toContain("first line");
      expect(text).toContain("second line");

      resetModelWarningState();
      const shared = fileModelWarningSink(logPath);
      const shared2 = fileModelWarningSink(logPath);
      expect(shared).toBe(shared2);
      shared({ message: "via singleton" });
      await new Promise((r) => setTimeout(r, 50));
      expect(await readFile(logPath, "utf8")).toContain("via singleton");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("memory sink collects entries", () => {
    const store: { message: string }[] = [];
    const sink = createMemoryModelWarningSink(store);
    sink({ message: "one" });
    sink({ message: "two" });
    expect(store.map((e) => e.message)).toEqual(["one", "two"]);
  });

  test("ollama context budget and missing API key warnings", () => {
    const out: string[] = [];
    const sink = (e: { message: string }) => out.push(e.message);
    warnOllamaContextBudget({ provider: "openai", model: "x" }, 4096, 5000, sink);
    expect(out.length).toBe(0);
    warnOllamaContextBudget({ provider: "ollama", model: "llama" }, 100, 200, sink);
    expect(out[0]).toContain("num_ctx");
    warnMissingApiKey("openai", "OPENAI_API_KEY", sink);
    warnMissingApiKey("openai", "OPENAI_API_KEY", sink);
    expect(out.filter((m) => m.includes("OPENAI_API_KEY")).length).toBe(1);
  });

  test("estimatePromptTokensFromChars rounds up", () => {
    expect(estimatePromptTokensFromChars(0)).toBe(0);
    expect(estimatePromptTokensFromChars(9)).toBe(3);
  });
});
