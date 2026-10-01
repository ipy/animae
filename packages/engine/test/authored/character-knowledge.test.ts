import { describe, expect, test } from "bun:test";
import { loadAuthored } from "../../src/authored/load.ts";
import { loadCharacterFromFiles } from "../../src/authored/characters.ts";
import { MemoryStorage } from "../../src/store/memory.ts";

describe("character knowledge files", () => {
  test("loadCharacterFromFiles picks up characters/<id>/knowledge/*.md", () => {
    const charId = "alice";
    const loaded = loadCharacterFromFiles(charId, [
      {
        path: `characters/${charId}/card.md`,
        content: `---
identity:
  name: Alice
  summary: s
tags: []
constraints:
  motives: []
  bottom_lines: []
  taboos: []
lod: principal
---
Persona.
`,
        hash: "a",
      },
      {
        path: `characters/${charId}/knowledge/voice.md`,
        content: `---
name: voice
description: d
scope: character:alice
inject: always
tags: []
priority: 1
---
Voice line.
`,
        hash: "b",
      },
    ]);
    expect(loaded.def.knowledge.length).toBe(1);
    expect(loaded.def.knowledge[0]!.id).toBe("character:alice/voice");
    expect(loaded.def.knowledge[0]!.body).toContain("Voice line");
  });

  test("loadAuthored merges character knowledge into catalog list", async () => {
    const s = MemoryStorage();
    await s.writeAtomic(
      "animae.yaml",
      `seed: 1
policies: []
`,
    );
    await s.writeAtomic(
      "world/world.yaml",
      `language: en
calendar:
  units: { minute: 1, hour: 60, day: 1440 }
  sceneMinutes: 30
  turnMinutes: 1
  chapters: []
`,
    );
    await s.writeAtomic(
      "characters/alice/card.md",
      `---
identity:
  name: Alice
  summary: s
tags: []
constraints:
  motives: []
  bottom_lines: []
  taboos: []
lod: principal
---
`,
    );
    await s.writeAtomic(
      "characters/alice/knowledge/note.md",
      `---
name: note
description: d
scope: character:alice
inject: when
when: "true"
tags: []
priority: 2
---
Note body.
`,
    );
    const authored = await loadAuthored(s);
    expect(authored.characters.alice?.knowledge.length).toBe(1);
    expect(authored.characters.alice?.knowledge[0]!.body).toBe("Note body.");
  });
});
