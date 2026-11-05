import { afterEach, describe, expect, test } from "bun:test";
import { clearLocalePacks } from "@animae/i18n";
import { createHostI18n } from "../src/i18n/host-i18n.ts";
import { registerFrenchHostLocalePack } from "./helpers/locale-packs.ts";

afterEach(() => clearLocalePacks());

describe("createHostI18n", () => {
  test("resolves dotted command keys in host catalog", () => {
    const en = createHostI18n("en");
    expect(en.t("command.saved", { label: "A", eventId: "ev1" })).toBe("Saved A @ ev1");
    expect(en.t("command.rewind_usage")).toContain("rewind");
    const off = registerFrenchHostLocalePack();
    try {
      const fr = createHostI18n("fr");
      expect(fr.t("command.load_ui_hint")).toContain("chargement");
    } finally {
      off();
    }
  });
});
