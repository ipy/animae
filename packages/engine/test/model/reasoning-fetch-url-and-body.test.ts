import { describe, expect, test } from "bun:test";
import {
  createReasoningAwareFetch,
  normalizeChatCompletionBody,
} from "../../src/model/reasoning-fetch.ts";
import { stubFetch } from "../helpers/fetch-stub.ts";

describe("createReasoningAwareFetch URL forms and body rewrite", () => {
  test("accepts URL and Request inputs for chat completion endpoints", async () => {
    let seenUrl = "";
    const baseFetch = stubFetch(async (input, init) => {
      seenUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (typeof input === "string" || input instanceof URL) {
        expect(init?.body).toBeDefined();
      }
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const wrapped = createReasoningAwareFetch(baseFetch);
    await wrapped(new URL("https://api.example.com/v1/chat/completions"), {
      method: "POST",
      body: JSON.stringify({ model: "m", messages: [] }),
    });
    expect(seenUrl).toContain("chat/completions");
    await wrapped(new Request("https://api.example.com/v1/messages", { method: "POST", body: "{}" }));
    expect(seenUrl).toContain("/v1/messages");
  });

  test("normalizeChatCompletionBody promotes reasoning JSON into assistant content", () => {
    const body = {
      choices: [{ message: { role: "assistant", content: "", reasoning: '{"ok":true}' } }],
    };
    const normalized = normalizeChatCompletionBody(body) as typeof body;
    expect(normalized.choices[0]?.message.content).toBe('{"ok":true}');
  });

  test("returns original response when JSON parse fails", async () => {
    const wrapped = createReasoningAwareFetch(
      stubFetch(async () => new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })),
    );
    const res = await wrapped("https://api.example.com/v1/chat/completions", { method: "POST" });
    expect(await res.text()).toBe("not-json");
  });
});
