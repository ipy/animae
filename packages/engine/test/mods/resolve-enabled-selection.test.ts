import { describe, expect, test } from "bun:test";
import { resolveMods } from "../../src/mods/resolve.ts";
import { testStorage } from "../helpers/storage.ts";
import type { ModBundle } from "../../src/mod.ts";

async function writeMod(storage: ReturnType<typeof testStorage>, id: string, extra = ""): Promise<void> {
  await storage.writeAtomic(
    `mods/${id}/mod.yaml`,
    `id: ${id}\nname: ${id}\nversion: 1.0.0\n${extra}`,
  );
  await storage.writeAtomic(`mods/${id}/data.txt`, "payload");
}

describe("resolveMods selection and bundles", () => {
  test("ModSelection object form filters enabled mods", async () => {
    const s = testStorage();
    await writeMod(s, "a");
    await writeMod(s, "b");
    const { ordered } = await resolveMods(s, ["a", "b"], {
      selection: [
        { id: "a", enabled: true },
        { id: "b", enabled: false },
      ],
    });
    expect(ordered.map((m) => m.id)).toEqual(["a"]);
  });

  test("bundle with empty files falls back to filesystem manifest", async () => {
    const s = testStorage();
    await writeMod(s, "bundled");
    const bundle: ModBundle = {
      manifest: { id: "bundled", name: "Bundled", version: "2.0.0" },
      files: {},
    };
    const { ordered } = await resolveMods(s, ["bundled"], { bundles: [bundle] });
    expect(ordered[0]?.version).toBe("2.0.0");
    expect(ordered[0]?.source).toBe("bundle");
  });

  test("engine version mismatch emits warning", async () => {
    const s = testStorage();
    await writeMod(s, "vermod", "engine: ^1.0.0\n");
    const { warnings } = await resolveMods(s, ["vermod"], { engineVersion: "2.0.0" });
    expect(warnings.some((w) => w.includes("vermod"))).toBe(true);
  });

});
