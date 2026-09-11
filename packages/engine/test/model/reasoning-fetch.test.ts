import { describe, expect, test } from "bun:test";
import {
  extractJsonObjectFromText,
  injectReasoningEffortNone,
  normalizeAssistantMessage,
  normalizeChatCompletionBody,
} from "../../src/model/reasoning-fetch.ts";

describe("reasoning-fetch", () => {
  test("extractJsonObjectFromText finds nested object", () => {
    const raw = 'prefix {"ok":true,"nested":{"a":1}} suffix';
    expect(extractJsonObjectFromText(raw)).toBe('{"ok":true,"nested":{"a":1}}');
  });

  test("normalizeAssistantMessage promotes reasoning JSON when content empty", () => {
    const msg = {
      role: "assistant",
      content: null,
      reasoning: 'We need JSON.\n{"ok":true}\n',
      reasoning_details: [{ type: "reasoning.text", text: "extra" }],
    };
    normalizeAssistantMessage(msg);
    expect(String(msg.content)).toBe('{"ok":true}');
    expect(msg.reasoning).toBeUndefined();
    expect(msg.reasoning_details).toBeUndefined();
  });

  test("injectReasoningEffortNone adds field to JSON body", () => {
    const out = injectReasoningEffortNone({
      method: "POST",
      body: JSON.stringify({ model: "m", messages: [] }),
    });
    expect(JSON.parse(String(out!.body)).reasoning_effort).toBe("none");
  });

  test("normalizeChatCompletionBody leaves content when present", () => {
    const body = {
      choices: [{ message: { role: "assistant", content: '{"text":"hi"}', reasoning: "hidden" } }],
    };
    normalizeChatCompletionBody(body);
    expect(body.choices[0]!.message.content).toBe('{"text":"hi"}');
    expect(body.choices[0]!.message.reasoning).toBeUndefined();
  });
});
