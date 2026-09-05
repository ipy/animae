import { describe, expect, test } from "bun:test";
import { sanitizeStructuredOutput, stripThinkingArtifacts } from "../../src/model/reasoning.ts";

describe("stripThinkingArtifacts", () => {
  test("removes think tags and reasoning fields", () => {
    const raw = ["<think>", "hidden", "</think>", "Hello"].join("");
    expect(stripThinkingArtifacts(raw)).toBe("Hello");
    const obj = sanitizeStructuredOutput<{ text: string }>({
      text: ["<think>", "x", "</think>", "visible"].join(""),
      reasoning_content: "secret",
    } as { text: string; reasoning_content: string });
    expect(obj).toEqual({ text: "visible" });
  });
});
