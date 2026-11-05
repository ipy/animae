import { describe, expect, test } from "bun:test";
import {
  chainReasoningFetch,
  createReasoningAwareFetch,
  extractJsonObjectFromText,
  injectReasoningEffortNone,
  normalizeAssistantMessage,
  normalizeChatCompletionBody,
} from "../../src/model/reasoning-fetch.ts";
import { stubFetch } from "../helpers/fetch-stub.ts";

describe("reasoning-fetch edge cases", () => {
  test("extractJsonObjectFromText respects strings and escapes", () => {
    expect(extractJsonObjectFromText('{"a":"}"}')).toBe('{"a":"}"}');
    expect(extractJsonObjectFromText("no json here")).toBeUndefined();
    expect(extractJsonObjectFromText('{ "unclosed": true')).toBeUndefined();
  });

  test("normalizeAssistantMessage uses reasoning_details and empty content fallback", () => {
    const msg = { role: "assistant", content: "", reasoning_details: [{ text: '{"x":1}' }] };
    normalizeAssistantMessage(msg);
    expect(msg.content).toBe('{"x":1}');
    const empty: { role: string; content?: string } = { role: "assistant" };
    normalizeAssistantMessage(empty);
    expect(empty.content).toBe("");
  });

  test("injectReasoningEffortNone skips when body already has reasoning fields or invalid JSON", () => {
    expect(injectReasoningEffortNone({ body: JSON.stringify({ reasoning_effort: "low" }) })?.body).toContain("low");
    expect(injectReasoningEffortNone({ body: "not-json" })).toEqual({ body: "not-json" });
    expect(injectReasoningEffortNone(undefined)).toBeUndefined();
  });

  test("createReasoningAwareFetch injects reasoning_effort on chat completion requests", async () => {
    let capturedBody: string | undefined;
    const baseFetch = stubFetch(async (_input, init) => {
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const wrapped = createReasoningAwareFetch(baseFetch);
    await wrapped("https://api.example.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "m", messages: [] }),
    });
    expect(JSON.parse(capturedBody!).reasoning_effort).toBe("none");
    expect(chainReasoningFetch(undefined, baseFetch)).toBeDefined();
  });

  test("normalizeChatCompletionBody ignores non-object bodies", () => {
    expect(normalizeChatCompletionBody(null)).toBe(null);
    expect(normalizeChatCompletionBody({ choices: "nope" })).toEqual({ choices: "nope" });
  });
});
