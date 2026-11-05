import { test, expect, describe } from "bun:test";
import { loadAuthored } from "../../src/authored/load.ts";
import { applyPatchMerge } from "../../src/mods/patch-merge.ts";
import { createLayeredStorage } from "../../src/mods/layered-storage.ts";
import { modDrift, resolveMods } from "../../src/mods/resolve.ts";
import { testStorage } from "../helpers/storage.ts";
import { AnimaeError } from "../../src/types.ts";
import type { ModBundle } from "../../src/mod.ts";
import { createRuleEngine } from "../../src/rules/rule-engine.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import type { RuleFn } from "../../src/contracts.ts";

async function seedMinimal(storage: ReturnType<typeof testStorage>): Promise<void> {
  await storage.writeAtomic(
    "animae.yaml",
    `seed: 1
policies: []
mods:
  - demo-mod
`,
  );
  await storage.writeAtomic("world/world.yaml", "title: Base\nlanguage: en\n");
}

test("layered storage stat without base.stat", async () => {
  const s = testStorage();
  await seedMinimal(s);
  await s.writeAtomic("world/world.yaml", "title: Base\nlanguage: en\n");
  const baseNoStat = {
    readText: (path: string) => s.readText(path),
    writeAtomic: () => Promise.reject(new Error("ro")),
    list: (dir: string) => s.list(dir),
    listFiles: (dir: string) => s.listFiles(dir),
    mkdir: () => Promise.reject(new Error("ro")),
    remove: () => Promise.reject(new Error("ro")),
    acquireLock: () => s.acquireLock(),
    releaseLock: () => s.releaseLock(),
  };
  const layered = createLayeredStorage({ base: baseNoStat as never, modLayers: [] });
  const st = await layered.stat("world/world.yaml");
  expect(st?.size).toBeGreaterThan(0);
});

test("patch merge operators", () => {
  expect(applyPatchMerge([1], { $append: [2] })).toEqual([1, 2]);
  expect(applyPatchMerge([1, 2], { $prepend: [0] })).toEqual([0, 1, 2]);
  expect(applyPatchMerge("b", { $append: "c" })).toBe("bc");
  expect(applyPatchMerge("b", { $prepend: "a" })).toBe("ab");
  expect(applyPatchMerge(undefined, { $append: "c" })).toBe("c");
  expect(applyPatchMerge([1, 2], { $replace: [3] })).toEqual([3]);
  expect(applyPatchMerge([{ id: "a" }, { id: "b" }], { $remove: [{ id: "a" }] })).toEqual([{ id: "b" }]);
  expect(applyPatchMerge({ a: 1, b: 2 }, { b: { $delete: true } })).toEqual({ a: 1 });
});

test("patching a policy document composes its unresolved $append / $prepend markers", () => {
  // The base is a game policy that extends a preset's array; the patch (a locale overlay) must keep the operator so the
  // later policy merge appends to the preset array instead of replacing it.
  const base = { appraise: { patterns: { $append: [{ id: "a" }] } }, render: { layers: { $prepend: [{ id: "x" }] } } };
  expect(applyPatchMerge(base, { appraise: { patterns: { $append: [{ id: "b" }] } } })).toEqual({
    appraise: { patterns: { $append: [{ id: "a" }, { id: "b" }] } },
    render: { layers: { $prepend: [{ id: "x" }] } },
  });
  expect(applyPatchMerge(base, { render: { layers: { $prepend: [{ id: "y" }] } } })).toEqual({
    appraise: { patterns: { $append: [{ id: "a" }] } },
    render: { layers: { $prepend: [{ id: "y" }, { id: "x" }] } },
  });
  expect(applyPatchMerge({ $append: "a" }, { $append: "b" })).toEqual({ $append: "ab" });
  expect(applyPatchMerge({ $prepend: "a" }, { $prepend: "b" })).toEqual({ $prepend: "ba" });
  // an empty placeholder marker is the documented extension point
  expect(applyPatchMerge({ patterns: { $append: [] } }, { patterns: { $append: [1] } })).toEqual({ patterns: { $append: [1] } });
  // a plain array base still resolves as before
  expect(applyPatchMerge({ list: [1] }, { list: { $append: [2] } })).toEqual({ list: [1, 2] });
});

test("mod layer replaces base location", async () => {
  const s = testStorage();
  await seedMinimal(s);
  await s.writeAtomic("world/locations/tavern.yaml", "id: tavern\nname: Tavern\n");
  await s.writeAtomic(
    "mods/demo-mod/mod.yaml",
    `id: demo-mod
name: Demo
version: 1.0.0
`,
  );
  await s.writeAtomic("mods/demo-mod/world/locations/tavern.yaml", "id: tavern\nname: Mod Tavern\n");

  const { ordered, layers } = await resolveMods(s, ["demo-mod"]);
  const prov = new Map();
  const layered = createLayeredStorage({ base: s, modLayers: layers, provenance: prov });
  const a = await loadAuthored(layered, { resolvedMods: ordered, modProvenance: prov });
  expect(a.locations.tavern?.name).toBe("Mod Tavern");
  expect(prov.get("world/locations/tavern.yaml")?.layer).toBe("mod");
});

test("patch yaml merges location", async () => {
  const s = testStorage();
  await seedMinimal(s);
  await s.writeAtomic("world/locations/tavern.yaml", "id: tavern\nname: Tavern\nsummary: base\n");
  await s.writeAtomic(
    "mods/demo-mod/mod.yaml",
    `id: demo-mod
name: Demo
version: 1.0.0
`,
  );
  await s.writeAtomic(
    "mods/demo-mod/world/locations/tavern.patch.yaml",
    `summary: patched
tags:
  $append: [modded]
`,
  );
  const { ordered, layers } = await resolveMods(s, ["demo-mod"]);
  const layered = createLayeredStorage({ base: s, modLayers: layers });
  const a = await loadAuthored(layered, { resolvedMods: ordered });
  expect(a.locations.tavern?.summary).toBe("patched");
  expect(a.locations.tavern?.tags).toContain("modded");
});

test("requires and conflicts", async () => {
  const s = testStorage();
  await seedMinimal(s);
  await s.writeAtomic("mods/a/mod.yaml", "id: a\nname: A\nversion: 1.0.0\n");
  await s.writeAtomic("mods/b/mod.yaml", "id: b\nname: B\nversion: 1.0.0\nrequires: [missing]\n");
  await expect(resolveMods(s, ["b"])).rejects.toMatchObject({ code: "MOD_CONFIG" });
  await s.writeAtomic("mods/b/mod.yaml", "id: b\nname: B\nversion: 1.0.0\nconflicts: [a]\n");
  await expect(resolveMods(s, ["a", "b"])).rejects.toMatchObject({ code: "MOD_CONFIG" });
});

test("loadAfter topology order", async () => {
  const s = testStorage();
  await seedMinimal(s);
  await s.writeAtomic("mods/base-mod/mod.yaml", "id: base-mod\nname: B\nversion: 1.0.0\n");
  await s.writeAtomic("mods/top-mod/mod.yaml", "id: top-mod\nname: T\nversion: 1.0.0\nloadAfter: [base-mod]\n");
  await s.writeAtomic("mods/base-mod/world/world.yaml", "title: FromBase\nlanguage: en\n");
  await s.writeAtomic("mods/top-mod/world/world.yaml", "title: FromTop\nlanguage: en\n");
  const { ordered } = await resolveMods(s, ["top-mod", "base-mod"]);
  expect(ordered.map((m) => m.id)).toEqual(["base-mod", "top-mod"]);
  const { layers } = await resolveMods(s, ["top-mod", "base-mod"]);
  const layered = createLayeredStorage({ base: s, modLayers: layers });
  const a = await loadAuthored(layered, { resolvedMods: ordered });
  expect(a.world.title).toBe("FromTop");
});

test("mod drift detection", () => {
  const current = [{ id: "a", name: "A", version: "1.0.0", contentHash: "x", tags: [], source: "filesystem" as const }];
  expect(modDrift(undefined, current).drift).toBe(true);
  expect(modDrift([{ id: "a", version: "1.0.0", contentHash: "x" }], current).drift).toBe(false);
});

test("authored hash changes when mod enabled", async () => {
  const s = testStorage();
  await storageNoMods(s);
  const base = await loadAuthored(s);
  await s.writeAtomic(
    "mods/x/mod.yaml",
    `id: x
name: X
version: 1.0.0
`,
  );
  await s.writeAtomic("mods/x/world/locations/new.yaml", "id: newloc\nname: New\n");
  await s.writeAtomic("animae.yaml", "seed: 1\npolicies: []\nmods: [x]\n");
  const { ordered, layers } = await resolveMods(s, ["x"]);
  const layered = createLayeredStorage({ base: s, modLayers: layers });
  const withMod = await loadAuthored(layered, { resolvedMods: ordered });
  expect(withMod.hash).not.toBe(base.hash);
});

async function storageNoMods(s: ReturnType<typeof testStorage>): Promise<void> {
  await s.writeAtomic("animae.yaml", "seed: 1\npolicies: []\n");
  await s.writeAtomic("world/world.yaml", "title: Base\nlanguage: en\n");
}

test("embedded ModBundle setup registers rule fn", () => {
  const cel = createCelEngine();
  const rules = createRuleEngine(cel, () => ({ seed: 1, rootBranch: "main" }));
  const fn: RuleFn = () => [];
  const bundle: ModBundle = {
    manifest: { id: "code-mod", name: "C", version: "1.0.0" },
    files: {},
    setup(ctx) {
      ctx.rules.register("mod_test_rule", fn);
    },
  };
  bundle.setup!({
    rules: { register: (n, f) => rules.register(n, f) },
    hooks: { register: () => {} },
    introspect: { registerViewer: () => {} },
  });
  expect(rules.has("mod_test_rule")).toBe(true);
});

describe("card append and patch", () => {
  test("card.patch and card.append", async () => {
    const s = testStorage();
    await seedMinimal(s);
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
Body one.
`,
    );
    await s.writeAtomic(
      "mods/demo-mod/mod.yaml",
      `id: demo-mod
name: Demo
version: 1.0.0
`,
    );
    await s.writeAtomic(
      "mods/demo-mod/characters/alice/card.patch.yaml",
      `tags:
  $append: [from-mod]
`,
    );
    await s.writeAtomic("mods/demo-mod/characters/alice/card.append.md", "\nAppended line.");
    const { ordered, layers } = await resolveMods(s, ["demo-mod"]);
    const layered = createLayeredStorage({ base: s, modLayers: layers });
    const a = await loadAuthored(layered, { resolvedMods: ordered });
    expect(a.characters.alice?.card.tags).toContain("from-mod");
    expect(a.characters.alice?.persona).toContain("Appended line.");
  });
});

test("invalid manifest throws MOD_CONFIG", async () => {
  const s = testStorage();
  await s.writeAtomic("mods/bad/mod.yaml", "id: not-kebab\nname: x\nversion: 1.0.0\n");
  await expect(resolveMods(s, ["bad"])).rejects.toBeInstanceOf(AnimaeError);
});
