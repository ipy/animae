import { describe, expect, test } from "bun:test";
import { explainAuthoredPath, formatExplainLine } from "../../src/mods/explain.ts";
import type { ModProvenanceEntry } from "../../src/mod.ts";

describe("mods explain", () => {
  test("explainAuthoredPath returns layer metadata", () => {
    const map = new Map<string, ModProvenanceEntry>();
    map.set("world/world.yaml", { layer: "base" });
    map.set("mods/x/world.yaml", { layer: "mod", id: "x" });
    expect(explainAuthoredPath(map, "missing")).toBeUndefined();
    expect(explainAuthoredPath(map, "world/world.yaml")).toEqual({
      path: "world/world.yaml",
      layer: { layer: "base" },
    });
  });

  test("formatExplainLine renders base, preset, and mod layers", () => {
    expect(formatExplainLine({ path: "a.yaml", layer: { layer: "base" } })).toBe("a.yaml\tbase");
    expect(formatExplainLine({ path: "p.yaml", layer: { layer: "preset", id: "core" } })).toBe("p.yaml\tpreset:core");
    expect(formatExplainLine({ path: "m.yaml", layer: { layer: "mod", id: "overlay" } })).toBe("m.yaml\tmod:overlay");
    expect(formatExplainLine({ path: "m.yaml", layer: { layer: "mod" } })).toBe("m.yaml\tmod:?");
  });
});
