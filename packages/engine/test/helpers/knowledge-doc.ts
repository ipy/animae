import type { KnowledgeDoc } from "../../src/schema/authored.ts";

/** Minimal valid knowledge doc for introspect/memory tests. */
export function testKnowledgeDoc(partial: Partial<KnowledgeDoc> & Pick<KnowledgeDoc, "id" | "body">): KnowledgeDoc {
  return {
    name: partial.name ?? partial.id,
    scope: "world",
    inject: "on-demand",
    tags: [],
    description: "",
    path: partial.path ?? `knowledge/${partial.id}.md`,
    priority: 0,
    shareable: false,
    ...partial,
  };
}
