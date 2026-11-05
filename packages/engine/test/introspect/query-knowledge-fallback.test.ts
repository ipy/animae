import { describe, expect, test } from "bun:test";
import { resolveQuery } from "../../src/introspect/query.ts";
import { createFakeKernel, charDef } from "../support/kernel-fake.ts";
import { AnchorDefSchema } from "../../src/schema/authored.ts";
import { testKnowledgeDoc } from "../helpers/knowledge-doc.ts";

describe("resolveQuery knowledge and director fallback", () => {
  test("character knowledge subpath lists authored docs", () => {
    const doc = testKnowledgeDoc({
      id: "k1",
      name: "Lore",
      body: "secret",
      scope: "character",
      tags: ["lore"],
      description: "desc",
      path: "characters/npc1/k1.md",
    });
    const { k } = createFakeKernel({
      chars: [{ ...charDef("npc1"), knowledge: [doc] }],
      policy: { visibility: { rules: [{ viewer: "player", path: "characters/npc1/knowledge", allow: true }] } },
    });
    const canRead = () => true;
    const rows = resolveQuery(k, "player", "characters/npc1/knowledge", canRead) as unknown[];
    expect(rows[0]).toMatchObject({ id: "k1", name: "Lore" });
  });

  test("director anchors falls back to authored list when service throws", () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "player", path: "director/anchors", allow: true }] } },
      director: {
        anchorsReferencing: () => {
          throw new Error("no runtime");
        },
      },
    });
    k.authored.anchors = [
      AnchorDefSchema.parse({
        id: "a1",
        target: { kind: "world_event", spec: { event: "other" } },
        deadline: { day: 1, minute: 0 },
      }),
    ];
    const canRead = () => true;
    const anchors = resolveQuery(k, "player", "director/anchors", canRead) as unknown[];
    expect(anchors[0]).toMatchObject({ id: "a1" });
  });
});
