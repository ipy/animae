import { describe, expect, test } from "bun:test";
import { MemoryStorage } from "../../src/store/memory.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { createDisplayResolver, resolveDisplayValue, resolveLocalizedMessage } from "../../src/i18n/display.ts";
import { minimalAuthored, minimalPolicy } from "../timeline/fixture.ts";

describe("display resolver", () => {
  test("createDisplayResolver localizes values and entity names", async () => {
    const storage = MemoryStorage();
    await storage.writeAtomic("locales/en/strings.yaml", "greeting: Hello\n");
    const authored = minimalAuthored();
    const policy = minimalPolicy();
    const state = initialState(authored, policy);
    const catalog = {
      character: (id: string) => authored.characters[id],
      characters: () => Object.values(authored.characters),
      location: (id: string) => authored.locations[id],
      locations: () => Object.values(authored.locations),
      item: () => undefined,
      template: () => undefined,
      knowledge: () => [],
    };
    const display = await createDisplayResolver({
      storage,
      locale: "en",
      state,
      catalog,
    });
    expect(display.t("greeting")).toBe("Hello");
    expect(display.resolve({ label: { $t: "greeting" } })).toEqual({ label: "Hello" });
    expect(display.entityDisplayName("npc1")).toBe("Npc One");
  });

  test("resolveDisplayValue and resolveLocalizedMessage delegate to t", () => {
    const t = (key: string) => (key === "k" ? "V" : key);
    expect(resolveDisplayValue({ x: { $t: "k" } }, t)).toEqual({ x: "V" });
    expect(resolveLocalizedMessage({ key: "k" }, t)).toBe("V");
    expect(resolveLocalizedMessage("plain", t)).toBe("plain");
  });
});
