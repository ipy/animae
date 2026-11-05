import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadPresetDir } from "../../src/policy/load-preset-dir.ts";
import { MemoryStorage } from "../../src/store/memory.ts";
import { AnimaeError } from "../../src/types.ts";

const presetBaseRoot = fileURLToPath(new URL("../../../preset-base", import.meta.url));

describe("loadPresetDir", () => {
  test("loads filesystem preset-base bundle with policies and knowledge", async () => {
    const bundle = await loadPresetDir(presetBaseRoot);
    expect(bundle.id).toBe("@animae/preset-base");
    expect(bundle.policies.some((p) => p.name.endsWith("base.yaml"))).toBe(true);
    expect(bundle.extends).toEqual([]);
  });

  test("storage preset.yaml missing id is CONFIG_INVALID", async () => {
    const storage = MemoryStorage();
    await storage.writeAtomic("preset.yaml", "extends: []\n");
    await expect(loadPresetDir(storage)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  test("storage loads yaml policies and markdown knowledge", async () => {
    const storage = MemoryStorage();
    await storage.writeAtomic(
      "preset.yaml",
      `id: test-preset
extends: []
policies:
  - policies/extra.yaml
`,
    );
    await storage.writeAtomic("policies/extra.yaml", "intent:\n  types: [talk]\n");
    await storage.writeAtomic("knowledge/world.md", "# World\n");
    await storage.writeAtomic("templates/scene.md", "Scene template");
    const bundle = await loadPresetDir(storage);
    expect(bundle.id).toBe("test-preset");
    expect(bundle.policies[0]?.doc).toEqual({ intent: { types: ["talk"] } });
    expect(bundle.knowledge?.["knowledge/world.md"]).toContain("World");
    expect(bundle.knowledge?.["templates/scene.md"]).toBe("Scene template");
  });

  test("filesystem preset missing id throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-bad-preset-"));
    try {
      await writeFile(join(root, "preset.yaml"), "extends: []\n");
      await expect(loadPresetDir(root)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("policy path not found on storage throws", async () => {
    const storage = MemoryStorage();
    await storage.writeAtomic(
      "preset.yaml",
      `id: x
policies:
  - missing.yaml
`,
    );
    await expect(loadPresetDir(storage)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  test("unsupported policy extension throws", async () => {
    const storage = MemoryStorage();
    await storage.writeAtomic("preset.yaml", "id: x\npolicies:\n  - bad.json\n");
    await storage.writeAtomic("bad.json", "{}");
    await expect(loadPresetDir(storage)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  test("ts policy module must default-export", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-ts-policy-"));
    try {
      await writeFile(join(root, "preset.yaml"), "id: ts\nextends: []\npolicies:\n  - doc.ts\n");
      await writeFile(join(root, "doc.ts"), "export const x = 1;\n");
      await expect(loadPresetDir(root)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ts policy module default export loads", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-ts-policy-ok-"));
    try {
      await writeFile(join(root, "preset.yaml"), "id: ts\nextends: []\npolicies:\n  - doc.ts\n");
      await writeFile(join(root, "doc.ts"), "export default { intent: { types: ['a'] } };\n");
      const bundle = await loadPresetDir(root);
      expect(bundle.policies[0]?.doc).toEqual({ intent: { types: ["a"] } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("missing knowledge directory is ignored", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-no-knowledge-"));
    try {
      await writeFile(join(root, "preset.yaml"), "id: bare\nextends: []\npolicies: []\n");
      const bundle = await loadPresetDir(root);
      expect(bundle.knowledge).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
