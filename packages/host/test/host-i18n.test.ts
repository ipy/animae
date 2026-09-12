import { describe, expect, test } from "bun:test";
import { createHostI18n } from "../src/i18n/host-i18n.ts";

describe("createHostI18n", () => {
  test("resolves dotted command keys in host catalog", () => {
    const en = createHostI18n("en");
    expect(en.t("command.saved", { label: "A", eventId: "ev1" })).toBe("Saved A @ ev1");
    expect(en.t("command.rewind_usage")).toContain("rewind");
    const zh = createHostI18n("zh-CN");
    expect(zh.t("command.load_ui_hint").length).toBeGreaterThan(4);
  });
});
