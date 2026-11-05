import { describe, expect, test } from "bun:test";
import type { ToolDef } from "../../src/ports.ts";
import { buildS2Tools } from "../../src/pipeline/render.ts";
import type { KnowledgeDoc } from "../../src/schema/authored.ts";
import { charDef, createPipelineKernel } from "./test-kernel.ts";

const doc = (id: string, body: string, over: Partial<KnowledgeDoc> = {}): KnowledgeDoc => ({
  id,
  path: `world/knowledge/${id}.md`,
  name: `Doc ${id}`,
  description: `about ${id}`,
  body,
  inject: "on-demand",
  scope: "world",
  shareable: false,
  tags: [],
  priority: 10,
  ...over,
});

function toolsFor(knowledge: KnowledgeDoc[] = []) {
  const { k } = createPipelineKernel({ chars: [charDef("npc1"), charDef("player")], knowledge });
  const tools = buildS2Tools(k, "npc1", "only");
  const byName = (name: string): ToolDef => tools.find((t) => t.name === name)!;
  return { k, tools, byName };
}

describe("S2 memory and knowledge tools", () => {
  test("a render may search and read, each described in the prompt language and strict about its input", () => {
    const { tools, byName } = toolsFor();
    expect(tools.map((t) => t.name)).toEqual(["search", "read"]);
    for (const tool of tools) expect(tool.description.length).toBeGreaterThan(10);

    const search = byName("search").input;
    expect(search.safeParse({ query: "the vault" }).success).toBe(true);
    expect(search.safeParse({ query: "the vault", scope: "world", tags: ["secret"] }).success).toBe(true);
    expect(search.safeParse({}).success).toBe(false);
    expect(search.safeParse({ query: "x", limit: 3 }).success).toBe(false);

    const read = byName("read").input;
    expect(read.safeParse({ id: "doc" }).success).toBe(true);
    expect(read.safeParse({}).success).toBe(false);
    expect(read.safeParse({ id: "doc", extra: 1 }).success).toBe(false);
  });

  test("read returns a known document and reports an unknown id instead of failing", async () => {
    const { byName } = toolsFor([doc("vault", "The vault lies beneath the old cellar.")]);
    expect(await byName("read").execute({ id: "vault" })).toEqual({
      name: "Doc vault",
      body: "The vault lies beneath the old cellar.",
    });
    expect(await byName("read").execute({ id: "no-such-doc" })).toEqual({ error: "not_found", id: "no-such-doc" });
  });

  test("search answers with compact hits: id, kind, score and at most 300 characters of text", async () => {
    const long = `vault ${"stone ".repeat(100)}`;
    const { byName } = toolsFor([doc("vault", long, { tags: ["place"] }), doc("garden", "Roses and herbs grow by the wall.")]);
    const hits = (await byName("search").execute({ query: "vault" })) as { id: string; kind: string; score: number; text: string }[];
    expect(hits.length).toBeGreaterThan(0);
    const vault = hits.find((h) => h.id === "vault")!;
    expect(vault.kind).toBe("knowledge");
    expect(typeof vault.score).toBe("number");
    expect(vault.text.length).toBeLessThanOrEqual(300);
    expect(Object.keys(vault).sort()).toEqual(["id", "kind", "score", "text"]);
    expect(hits.some((h) => h.id === "garden")).toBe(false);
  });
});
