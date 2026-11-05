import { describe, expect, test } from "bun:test";
import {
  createLanguageModel,
  normalizeAnthropicBaseURL,
  resolveAnthropicBaseURL,
} from "../../src/model/provider.ts";
import type { ModelSpec } from "../../src/schema/authored.ts";
import { AnimaeError } from "../../src/types.ts";

const env = { OPENAI_COMPATIBLE_API_KEY: "k" };
const sink = { push: () => {} };

/** Provider constructors are lazy: building a model never touches the network. */
describe("createLanguageModel", () => {
  const cases: { spec: ModelSpec; label: string }[] = [
    { label: "anthropic", spec: { provider: "anthropic", model: "claude-test", apiKey: "k" } },
    { label: "openai", spec: { provider: "openai", model: "gpt-test", apiKey: "k" } },
    { label: "google", spec: { provider: "google", model: "gemini-test", apiKey: "k" } },
    { label: "deepseek", spec: { provider: "deepseek", model: "deepseek-test", apiKey: "k" } },
    { label: "ollama", spec: { provider: "ollama", model: "llama-test", baseURL: "http://127.0.0.1:11434" } },
    {
      label: "openai-compatible",
      spec: { provider: "openai-compatible", model: "local-test", baseURL: "http://127.0.0.1:8080/v1", name: "gateway" },
    },
  ];

  for (const { spec, label } of cases) {
    test(`${label} builds a model that carries the configured model id`, () => {
      const model = createLanguageModel(spec, { env, warningSink: sink as never }) as { modelId?: string };
      expect(model.modelId).toBe(spec.model);
    });
  }

  test("openai-compatible without a baseURL is a configuration error", () => {
    let caught: unknown;
    try {
      createLanguageModel({ provider: "openai-compatible", model: "m" }, { env });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnimaeError);
    expect((caught as AnimaeError).code).toBe("MODEL_CONFIG");
  });

  test("an unknown provider is a configuration error", () => {
    let caught: unknown;
    try {
      createLanguageModel({ provider: "mystery", model: "m" } as unknown as ModelSpec, { env });
    } catch (e) {
      caught = e;
    }
    expect((caught as AnimaeError).code).toBe("MODEL_CONFIG");
    expect((caught as AnimaeError).message).toContain("mystery");
  });
});

describe("anthropic base URL resolution", () => {
  test("a value that is not a URL only loses its trailing slashes", () => {
    expect(normalizeAnthropicBaseURL("gateway.internal/anthropic///")).toBe("gateway.internal/anthropic");
  });

  test("the spec's baseURL wins over the environment, which wins over nothing", () => {
    const env = { ANTHROPIC_BASE_URL: "https://env.example/anthropic" };
    expect(resolveAnthropicBaseURL({ baseURL: "https://spec.example" }, env)).toBe("https://spec.example/v1");
    expect(resolveAnthropicBaseURL({}, env)).toBe("https://env.example/anthropic/v1");
    expect(resolveAnthropicBaseURL({ baseURL: "  " }, env)).toBe("https://env.example/anthropic/v1");
    expect(resolveAnthropicBaseURL({}, {})).toBeUndefined();
  });
});
