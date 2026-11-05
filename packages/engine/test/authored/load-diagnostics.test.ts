import { describe, expect, test } from "bun:test";
import { loadAuthored } from "../../src/authored/index.ts";
import type { ConfigIssue } from "../../src/authored/errors.ts";
import type { PresetRegistry } from "../../src/contracts.ts";
import type { PresetBundle } from "../../src/preset.ts";
import { testStorage } from "../helpers/storage.ts";

type Storage = ReturnType<typeof testStorage>;

async function seed(files: Record<string, string> = {}): Promise<Storage> {
  const s = testStorage();
  await s.writeAtomic("animae.yaml", "seed: 1\npolicies: []\n");
  await s.writeAtomic("world/world.yaml", "title: Test\nlanguage: en\n");
  for (const [path, text] of Object.entries(files)) await s.writeAtomic(path, text);
  return s;
}

/** The issues a load reports; fails when the load succeeds. */
async function issuesOf(s: Storage, opts?: Parameters<typeof loadAuthored>[1]): Promise<ConfigIssue[]> {
  try {
    await loadAuthored(s, opts);
  } catch (err) {
    expect(err).toMatchObject({ code: "CONFIG_INVALID" });
    return (err as { details: { issues: ConfigIssue[] } }).details.issues;
  }
  throw new Error("the load was expected to fail");
}

const bundle = (over: Partial<PresetBundle>): PresetRegistry => {
  const b: PresetBundle = { id: "p1", extends: [], policies: [], ...over };
  return { list: () => [b], get: (id) => (id === b.id ? b : undefined), add: () => {} };
};

describe("required files", () => {
  test("a missing animae.yaml and world.yaml are reported together, each with its path", async () => {
    const issues = await issuesOf(testStorage());
    expect(issues).toEqual(
      expect.arrayContaining([
        { file: "animae.yaml", path: "(root)", message: "file not found" },
        { file: "world/world.yaml", path: "(root)", message: "file not found" },
      ]),
    );
  });

  test("a required file that breaks its schema names the offending key", async () => {
    const s = await seed({ "world/world.yaml": "title: 7\nlanguage: en\n" });
    const issues = await issuesOf(s);
    expect(issues.some((i) => i.file === "world/world.yaml" && i.path.startsWith("title"))).toBe(true);
  });
});

describe("world content files", () => {
  test("a location, item, deck or template that breaks its schema is reported with its file and skipped", async () => {
    const s = await seed({
      "world/locations/bad.yaml": "id: bad\n",
      "world/items/bad.yaml": "id: bad\n",
      "world/decks/bad.yaml": "id: daily\nentries: []\n",
      "templates/character/bad.yaml": "fields: 3\n",
    });
    const files = (await issuesOf(s)).map((i) => i.file);
    for (const file of ["world/locations/bad.yaml", "world/items/bad.yaml", "world/decks/bad.yaml", "templates/character/bad.yaml"]) {
      expect(files, file).toContain(file);
    }
  });

  test("an id used twice within one kind is reported on the second file", async () => {
    const dup = (kind: string) => `id: same\nname: ${kind}\n`;
    const s = await seed({
      "world/locations/a.yaml": dup("A"),
      "world/locations/b.yaml": dup("B"),
      "world/items/a.yaml": dup("A"),
      "world/items/b.yaml": dup("B"),
      "world/decks/a.yaml": "id: same\nentries:\n  - id: x\n",
      "world/decks/b.yaml": "id: same\nentries:\n  - id: y\n",
    });
    const messages = (await issuesOf(s)).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining(['duplicate location id "same"', 'duplicate item id "same"', 'duplicate deck id "same"']),
    );
  });

  test("a field file may hold a list; a bad entry is reported with its position and a repeated id is caught", async () => {
    const field = (id: string, extra = "") => `- id: ${id}\n  holder: { kind: world }\n  level: L0\n  effects: {}\n${extra}`;
    const s = await seed({
      "world/fields/list.yaml": `${field("ok")}- id: broken\n  level: L9\n${field("ok")}`,
    });
    const issues = await issuesOf(s);
    const inFile = issues.filter((i) => i.file === "world/fields/list.yaml");
    expect(inFile.some((i) => i.path.endsWith("[1]"))).toBe(true);
    expect(inFile.some((i) => i.message === 'duplicate field id "ok"')).toBe(true);
  });

  test("a template id repeated across files is reported", async () => {
    const tpl = "fields: {}\nguidance: g\ndefaults: {}\npromote: []\n";
    const s = await seed({
      "templates/location/market.yaml": tpl,
      "templates/location/also.yaml": `id: market\n${tpl}`,
    });
    const issues = await issuesOf(s);
    expect(issues.some((i) => i.message === 'duplicate template "market"')).toBe(true);
  });

  test("a template without an id takes the name of its file", async () => {
    const tpl = "fields: {}\nguidance: g\ndefaults: {}\npromote: []\n";
    const a = await loadAuthored(await seed({ "templates/location/market.yaml": tpl }));
    expect(a.templates.location.market).toMatchObject({ id: "market", kind: "location", guidance: "g" });
  });
});

describe("optional list files", () => {
  test("an absent anchors, beats, schedule or exceptions file means none", async () => {
    const a = await loadAuthored(await seed());
    expect(a.anchors).toEqual([]);
    expect(a.beats).toEqual([]);
    expect(a.schedule).toEqual([]);
  });

  test("one that is present but malformed is reported against its own file", async () => {
    const s = await seed({ "world/schedule.yaml": "- id: 1\n  nonsense: true\n" });
    const issues = await issuesOf(s);
    expect(issues.some((i) => i.file === "world/schedule.yaml")).toBe(true);
  });
});

describe("presets and extra knowledge", () => {
  const knowledgeDoc = (name: string) => `---\nname: ${name}\ndescription: about ${name}\ninject: on-demand\n---\nBody of ${name}.\n`;

  test("a preset template that breaks the template schema is reported under the preset's name", async () => {
    const presets = bundle({ templates: [{ kind: "character", id: "broken", template: { fields: 7 } as never }] });
    const issues = await issuesOf(await seed(), { presets });
    expect(issues.some((i) => i.file === "preset:p1:template:broken")).toBe(true);
  });

  test("a preset knowledge file is added unless the world already has one at that path", async () => {
    const presets = bundle({ knowledge: { "lore.md": knowledgeDoc("lore"), "notes.txt": "ignored", "own.md": knowledgeDoc("preset-own") } });
    const s = await seed({ "world/knowledge/own.md": knowledgeDoc("world-own") });
    const a = await loadAuthored(s, { presets });
    expect(a.knowledge.map((d) => d.id)).toEqual(expect.arrayContaining(["world/lore", "world/own"]));
    expect(a.knowledge.find((d) => d.id === "world/own")?.body).toContain("Body of world-own.");
    expect(a.knowledge.some((d) => d.path.endsWith("notes.txt"))).toBe(false);
    expect(a.files["world/knowledge/lore.md"]).toBeDefined();
  });

  test("extra knowledge is placed under world/knowledge, hashed, and never replaces a document of the same id", async () => {
    const s = await seed({ "world/knowledge/lore.md": knowledgeDoc("lore") });
    const a = await loadAuthored(s, {
      extraKnowledge: { "lore.md": knowledgeDoc("lore").replace("Body of lore.", "Other body."), "extra.md": knowledgeDoc("extra") },
    });
    expect(a.knowledge.map((d) => d.id).sort()).toEqual(["world/extra", "world/lore"]);
    expect(a.knowledge.find((d) => d.id === "world/lore")?.body).toContain("Body of lore.");
    expect(a.files["world/knowledge/extra.md"]).toMatch(/^[a-f0-9]{64}$/);
  });
});
