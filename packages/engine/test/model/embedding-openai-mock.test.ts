import { describe, expect, test, afterEach } from "bun:test";
import { createEmbeddingPort, resetModelWarningState } from "../../src/model/index.ts";

describe("createEmbeddingPort openai mock", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
    resetModelWarningState();
  });

  test("embed calls provider and returns float vectors", async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.method === "POST" && req.url.includes("/embeddings")) {
          return Response.json({
            data: [{ embedding: [0.1, 0.2], index: 0 }],
            usage: { prompt_tokens: 1, total_tokens: 1 },
          });
        }
        return new Response("missing", { status: 404 });
      },
    });
    const port = createEmbeddingPort(
      { provider: "openai", model: "text-embedding-3-small", baseURL: `http://127.0.0.1:${server.port}/v1` },
      { env: { OPENAI_API_KEY: "test" }, fetch: globalThis.fetch },
    );
    const vectors = await port.embed(["hello"]);
    expect(vectors[0]?.length).toBe(2);
    expect(vectors[0]?.[0]).toBeCloseTo(0.1);
  });
});
