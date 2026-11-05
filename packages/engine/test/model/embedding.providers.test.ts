import { describe, expect, test, afterEach } from "bun:test";
import { createEmbeddingPort, resetModelWarningState } from "../../src/model/index.ts";
import { AnimaeError } from "../../src/types.ts";

describe("createEmbeddingPort provider branches", () => {
  afterEach(() => resetModelWarningState());

  test("deepseek rejects embeddings", () => {
    expect(() => createEmbeddingPort({ provider: "deepseek", model: "x" })).toThrow(AnimaeError);
    try {
      createEmbeddingPort({ provider: "deepseek", model: "x" });
    } catch (e) {
      expect((e as AnimaeError).code).toBe("MODEL_CONFIG");
      expect(String((e as AnimaeError).message)).toContain("deepseek");
    }
  });

  test("openai-compatible requires baseURL", () => {
    expect(() => createEmbeddingPort({ provider: "openai-compatible", model: "emb" })).toThrow(AnimaeError);
    try {
      createEmbeddingPort({ provider: "openai-compatible", model: "emb", baseURL: "   " });
    } catch (e) {
      expect((e as AnimaeError).code).toBe("MODEL_CONFIG");
    }
  });

  test("openai-compatible embed uses mock server", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.method === "POST" && req.url.includes("/embeddings")) {
          return Response.json({
            data: [{ embedding: [0.3, 0.7], index: 0 }],
            usage: { prompt_tokens: 1, total_tokens: 1 },
          });
        }
        return new Response("missing", { status: 404 });
      },
    });
    try {
      const port = createEmbeddingPort(
        {
          provider: "openai-compatible",
          model: "embed-v1",
          baseURL: `http://127.0.0.1:${server.port}/v1`,
          name: "local-embed",
        },
        { env: { OPENAI_API_KEY: "test" }, fetch: globalThis.fetch },
      );
      const vectors = await port.embed(["phrase"]);
      expect(vectors[0]?.length).toBe(2);
      expect(vectors[0]?.[1]).toBeCloseTo(0.7);
    } finally {
      server.stop(true);
    }
  });

  test("anthropic has no embedding endpoint: configuration error instead of an SDK error", () => {
    let caught: unknown;
    try {
      createEmbeddingPort({ provider: "anthropic", model: "voyage-3" }, { env: { ANTHROPIC_API_KEY: "k" } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnimaeError);
    expect((caught as AnimaeError).code).toBe("MODEL_CONFIG");
    expect((caught as AnimaeError).message).toContain("anthropic provider does not expose embeddings");
  });

  test("google and ollama ports construct without calling embed", () => {
    const google = createEmbeddingPort(
      { provider: "google", model: "text-embedding-004" },
      { env: { GOOGLE_GENERATIVE_AI_API_KEY: "k" } },
    );
    const ollama = createEmbeddingPort({
      provider: "ollama",
      model: "nomic-embed-text",
      baseURL: "http://127.0.0.1:11434",
    });
    expect(typeof google.embed).toBe("function");
    expect(typeof ollama.embed).toBe("function");
  });

  test("unknown provider is MODEL_CONFIG", () => {
    expect(() =>
      createEmbeddingPort({ provider: "not-a-provider" as "openai", model: "x" }),
    ).toThrow(AnimaeError);
  });
});
