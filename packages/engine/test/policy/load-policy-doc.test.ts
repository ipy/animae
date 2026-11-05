import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPolicyDocFromPath } from "../../src/policy/load-policy-doc.ts";
import { MemoryStorage } from "../../src/store/memory.ts";
import { AnimaeError } from "../../src/types.ts";

describe("loadPolicyDocFromPath", () => {
  test("loads yaml from storage", async () => {
    const storage = MemoryStorage();
    await storage.writeAtomic("rules/extra.yaml", "intent:\n  types: [listen]\n");
    const doc = await loadPolicyDocFromPath(storage, "rules/extra.yaml");
    expect(doc.name).toBe("rules/extra.yaml");
    expect(doc.doc).toEqual({ intent: { types: ["listen"] } });
  });

  test("missing yaml throws CONFIG_INVALID", async () => {
    const storage = MemoryStorage();
    await expect(loadPolicyDocFromPath(storage, "nope.yaml")).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  test("unsupported extension throws", async () => {
    const storage = MemoryStorage();
    await storage.writeAtomic("x.json", "{}");
    await expect(loadPolicyDocFromPath(storage, "x.json")).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  test("ts module without default export throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-policy-doc-"));
    const storage = MemoryStorage(root);
    try {
      await writeFile(join(root, "mod.ts"), "export const v = 1;\n");
      await expect(loadPolicyDocFromPath(storage, "mod.ts")).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ts default export loads document", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-policy-doc-ok-"));
    const storage = MemoryStorage(root);
    try {
      await writeFile(join(root, "mod.ts"), "export default { tracks: {} };\n");
      const doc = await loadPolicyDocFromPath(storage, "mod.ts");
      expect(doc.doc).toEqual({ tracks: {} });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
