import { describe, expect, test, afterEach } from "bun:test";
import { z } from "zod";
import { createEmbeddingPort, createModelPort, resetModelWarningState } from "../../src/model/index.ts";

const pingSchema = z.object({ ok: z.literal(true) });

function startFakeOllama() {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/tags" && req.method === "GET") {
        return Response.json({ models: [{ name: "fake:latest" }] });
      }
      if ((url.pathname === "/api/chat" || url.pathname === "/chat") && req.method === "POST") {
        const body = (await req.json()) as { stream?: boolean; format?: string };
        const content = body.format ? JSON.stringify({ ok: true }) : "hello";
        const stamp = new Date().toISOString();
        const payload = {
          model: "fake",
          created_at: stamp,
          message: { role: "assistant", content },
          done: true,
        };
        if (body.stream) {
          const line = JSON.stringify(payload);
          return new Response(`${line}\n`, { headers: { "Content-Type": "application/x-ndjson" } });
        }
        return Response.json(payload);
      }
      if ((url.pathname === "/api/embed" || url.pathname === "/embed") && req.method === "POST") {
        const body = (await req.json()) as { model?: string };
        return Response.json({
          model: body.model ?? "nomic-embed-text",
          embeddings: [[0.1, 0.2, 0.3]],
          total_duration: 1,
          load_duration: 1,
          prompt_eval_count: 1,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

describe("ollama native API", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
    resetModelWarningState();
  });

  test("structured object and embedding via /api/chat and /api/embed", async () => {
    server = startFakeOllama();
    const baseURL = `http://127.0.0.1:${server.port}`;
    const spec = { provider: "ollama" as const, model: "fake:latest", baseURL };
    const port = createModelPort(spec, { env: {} });
    const out = await port.object({
      label: "test.ping",
      segments: {
        static: "Return JSON {\"ok\":true}",
        semiStatic: "",
        dynamic: "",
        user: "ping",
        history: [],
      },
      maxOutputTokens: 64,
      temperature: 0,
      schema: pingSchema,
    });
    expect(out.ok).toBe(true);

    const embed = createEmbeddingPort({ ...spec, model: "nomic-embed-text" }, { env: {} });
    const vectors = await embed.embed(["hi"]);
    expect(vectors[0]?.length).toBe(3);
  });

  test("streaming structured output", async () => {
    server = startFakeOllama();
    const baseURL = `http://127.0.0.1:${server.port}`;
    const port = createModelPort(
      { provider: "ollama", model: "fake:latest", baseURL },
      { env: {} },
    );
    const parts = [];
    for await (const p of port.stream({
      label: "test.stream",
      segments: {
        static: "Return JSON {\"ok\":true}",
        semiStatic: "",
        dynamic: "",
        user: "ping",
        history: [],
      },
      maxOutputTokens: 64,
      temperature: 0,
      schema: pingSchema,
    })) {
      parts.push(p);
    }
    const fin = parts.find((p) => p.type === "final");
    expect(fin && fin.type === "final" && (fin.value as { ok?: boolean }).ok).toBe(true);
  });
});
