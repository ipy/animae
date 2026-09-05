#!/usr/bin/env node
import { createEngine } from "../dist/index.js";
import { createScriptedModel } from "../dist/model/index.js";
import { MemoryStorage } from "../dist/store/index.js";

const storage = MemoryStorage();
await storage.writeAtomic("animae.yaml", "seed: 1\npolicies: []\n");
await storage.writeAtomic(
  "world/world.yaml",
  "language: en\nstart: {day: 1, minute: 480}\nplayer: player\nstart_location: tavern\nvars: {}\npublic_vars: []\nfactions: {}\ncalendar: {units: {minute: 1, hour: 60, day: 1440}, sceneMinutes: 30, turnMinutes: 1, chapters: []}\n",
);
await storage.writeAtomic("world/locations/tavern.yaml", "id: tavern\nname: Tavern\nsummary: ''\ntags: []\nconnects: []\nvars: {}\n");
await storage.writeAtomic("characters/npc1/card.md", "---\nidentity:\n  name: Npc\n  summary: ''\n  style_examples: []\nlod: principal\ntags: []\nconstraints:\n  motives: []\n  bottom_lines: []\n  taboos: []\n---\nHi\n");
await storage.writeAtomic("characters/npc1/traits.yaml", "event_mult: {}\n");
await storage.writeAtomic("characters/npc1/tracks.yaml", "self: {}\ntoward: {}\noverrides: {}\n");
await storage.writeAtomic("characters/npc1/goals.yaml", "[]\n");
await storage.writeAtomic("characters/npc1/secrets.yaml", "[]\n");
await storage.writeAtomic("characters/npc1/relations.yaml", "[]\n");

const scripted = createScriptedModel("smoke/s1", async () => ({
  type: "chat",
  intensity: 0.5,
  sincerity: 0.8,
  claims: [],
  search_terms: [],
  tags: [],
  input_class: "normal",
}));

const engine = await createEngine({
  root: storage.root,
  ports: { storage },
  models: { s1: scripted, s2: scripted },
  modelMode: "live",
  sessionId: "smoke",
});

await engine.world.set("smoke", 1);
const events = await engine.timeline.events({ kinds: ["world.var_set"], limit: 20 });
const wrote = events.some((e) => e.kind === "world.var_set" && e.path === "smoke" && e.value === 1);
if (!wrote) {
  console.error("smoke failed: world.var_set not recorded", events);
  process.exit(1);
}
console.log("node-smoke ok", engine.info().branch);
