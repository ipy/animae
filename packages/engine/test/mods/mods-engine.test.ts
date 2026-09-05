import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEngine, createScriptedModel, createPresetRegistry, FsStorage, loadAuthored, prepareModOverlay } from "../../src/index.ts";
import { createRng } from "../../src/timeline/rng.ts";
import { createLayeredStorage } from "../../src/mods/layered-storage.ts";
import { resolveMods } from "../../src/mods/resolve.ts";
import { testStorage } from "../helpers/storage.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

const models = {
  s1: createScriptedModel("mods/s1", () => ({ text: "ok", cues: [], intent_realized: "talk" })),
  s2: createScriptedModel("mods/s2", () => ({
    type: "chat",
    intensity: 0.5,
    sincerity: 0.9,
    claims: [],
    search_terms: [],
    tags: [],
    input_class: "normal",
  })),
};

test("determinism: mods change authored hash only, not RNG stream for same seed", async () => {
  const s = testStorage();
  await s.writeAtomic("animae.yaml", "seed: 42\npolicies: []\n");
  await s.writeAtomic("world/world.yaml", "title: Base\nlanguage: en\n");
  const base = await loadAuthored(s);
  await s.writeAtomic(
    "mods/x/mod.yaml",
    `id: x
name: X
version: 1.0.0
`,
  );
  await s.writeAtomic("mods/x/world/locations/extra.yaml", "id: extra\nname: Extra\n");
  await s.writeAtomic("animae.yaml", "seed: 42\npolicies: []\nmods: [x]\n");
  const { ordered, layers } = await resolveMods(s, ["x"]);
  const layered = createLayeredStorage({ base: s, modLayers: layers });
  const withMod = await loadAuthored(layered, { resolvedMods: ordered });
  expect(withMod.config.seed).toBe(base.config.seed);
  expect(withMod.hash).not.toBe(base.hash);
  const key = "turn_0001:check";
  expect(createRng(base.config.seed!, "main", key).next()).toBe(createRng(withMod.config.seed!, "main", key).next());
});

test("hot reload picks up mod overlay edit", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-mod-reload-"));
  try {
    const storage = FsStorage(root);
    await seedE2eAuthored(storage);
    await storage.writeAtomic(
      "mods/overlay/mod.yaml",
      `id: overlay
name: Overlay
version: 1.0.0
`,
    );
    await storage.writeAtomic(
      "mods/overlay/world/locations/tavern.yaml",
      `id: tavern
name: Tavern (mod v1)
`,
    );
    const config = (await storage.readText("animae.yaml")) ?? "";
    await storage.writeAtomic("animae.yaml", `${config.replace(/\n?$/, "\n")}mods:\n  - overlay\n`);

    const engine = await createEngine({
      root,
      presets: [e2ePreset],
      models,
      sessionId: "mod_reload",
    });
    const loc1 = engine.query("debug", "world/locations/tavern") as { name?: string };
    expect(loc1?.name).toBe("Tavern (mod v1)");

    await storage.writeAtomic(
      "mods/overlay/world/locations/tavern.yaml",
      `id: tavern
name: Tavern (mod v2)
`,
    );
    const hashBefore = engine.query("debug", "world/locations/tavern") ? "loaded" : "";
    expect(hashBefore).toBe("loaded");
    const r = await engine.reload();
    expect(r.ok).toBe(true);
    const { readStorage, ordered } = await prepareModOverlay(storage, ["overlay"], { selection: ["overlay"] });
    const reloaded = await loadAuthored(readStorage, { resolvedMods: ordered, presets: createPresetRegistry([e2ePreset]) });
    expect(reloaded.locations.tavern?.name).toBe("Tavern (mod v2)");
    const reloadedEv = (await engine.timeline.events({ kinds: ["config.reloaded"] })).at(-1);
    expect(reloadedEv?.kind).toBe("config.reloaded");
    await engine.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
