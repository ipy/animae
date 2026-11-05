import { describe, expect, test } from "bun:test";
import { resolveMods } from "../../src/mods/resolve.ts";
import { testStorage } from "../helpers/storage.ts";
import type { ModBundle } from "../../src/mod.ts";

describe("resolveMods bundled file payloads", () => {
  test("non-empty ModBundle files skip filesystem scan and hash bundled content", async () => {
    const s = testStorage();
    await s.writeAtomic("mods/embedded/mod.yaml", "id: embedded\nname: X\nversion: 9.0.0\n");
    await s.writeAtomic("mods/embedded/extra.txt", "filesystem-only");
    const bundle: ModBundle = {
      manifest: { id: "embedded", name: "Embedded", version: "1.0.0" },
      files: { "world/world.yaml": "title: FromBundle\nlanguage: en\n" },
    };
    const { ordered, bundles } = await resolveMods(s, ["embedded"], { bundles: [bundle] });
    expect(ordered[0]?.source).toBe("bundle");
    expect(ordered[0]?.version).toBe("1.0.0");
    expect(bundles[0]?.files["world/world.yaml"]).toContain("FromBundle");
    expect(bundles[0]?.files.extra).toBeUndefined();
  });

  test("preset-style requires are ignored for enabled check", async () => {
    const s = testStorage();
    await s.writeAtomic("mods/use-preset/mod.yaml", "id: use-preset\nname: U\nversion: 1.0.0\nrequires: ['@preset-base']\n");
    const { ordered } = await resolveMods(s, ["use-preset"]);
    expect(ordered.map((m) => m.id)).toEqual(["use-preset"]);
  });

  test("mod dependency cycle throws MOD_CONFIG", async () => {
    const s = testStorage();
    await s.writeAtomic("mods/a/mod.yaml", "id: a\nname: A\nversion: 1.0.0\nrequires: [b]\n");
    await s.writeAtomic("mods/b/mod.yaml", "id: b\nname: B\nversion: 1.0.0\nrequires: [a]\n");
    await expect(resolveMods(s, ["a", "b"])).rejects.toMatchObject({ code: "MOD_CONFIG" });
  });
});
