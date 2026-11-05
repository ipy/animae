import { describe, expect, test } from "bun:test";
import { createEmbeddingPort } from "../../src/model/embedding.ts";
import { AnimaeError } from "../../src/types.ts";

describe("createEmbeddingPort config", () => {
  test("deepseek provider rejects embeddings", () => {
    expect(() => createEmbeddingPort({ provider: "deepseek", model: "x" }, { env: {} })).toThrow(AnimaeError);
    try {
      createEmbeddingPort({ provider: "deepseek", model: "x" }, { env: {} });
    } catch (e) {
      expect((e as AnimaeError).code).toBe("MODEL_CONFIG");
      expect((e as AnimaeError).message).toContain("deepseek");
    }
  });

  test("openai-compatible requires baseURL", () => {
    expect(() => createEmbeddingPort({ provider: "openai-compatible", model: "e" }, { env: {} })).toThrow(AnimaeError);
  });

  test("unknown provider is MODEL_CONFIG", () => {
    expect(() =>
      createEmbeddingPort({ provider: "unknown" as "openai", model: "x" }, { env: {} }),
    ).toThrow(AnimaeError);
  });
});
