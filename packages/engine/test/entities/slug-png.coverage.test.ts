import { describe, expect, test } from "bun:test";
import { slugId, uniqueId } from "../../src/entities/slug.ts";
import { buildPngWithCharaChunk, extractSillyTavernJsonFromPng } from "../../src/entities/png-chunks.ts";
describe("slugId and uniqueId", () => {
  test("slugId normalizes spaces and punctuation", () => {
    expect(slugId("  Hello World!  ")).toBe("hello-world");
    expect(slugId("___")).toBe("x");
    expect(slugId("!!!")).toBe("entity");
  });

  test("uniqueId suffixes when base exists", () => {
    const taken = new Set(["hero", "hero-2"]);
    expect(uniqueId("hero", (id) => taken.has(id))).toBe("hero-3");
    expect(uniqueId("new", () => false)).toBe("new");
  });
});

describe("png chara chunk", () => {
  test("round-trip sillytavern json", () => {
    const payload = { name: "Test", description: "d" };
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
    const png = buildPngWithCharaChunk(b64);
    expect(JSON.parse(extractSillyTavernJsonFromPng(png)!)).toEqual(payload);
  });

  test("extract returns undefined for non-png bytes", () => {
    expect(extractSillyTavernJsonFromPng(new Uint8Array([0, 1, 2]))).toBeUndefined();
  });
});
