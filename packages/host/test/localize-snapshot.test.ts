import { describe, expect, spyOn, test } from "bun:test";
import { createI18n } from "@animae/i18n";
import { localizeDeep } from "@animae/i18n";
import { bindLocalizeTranslator, localizeSnapshot } from "../src/localize-snapshot.ts";

describe("localizeSnapshot preset display strings", () => {
  test("resolves dnd check copy and drops i18n when localized", () => {
    const en = createI18n({
      locale: "en",
      defaultNamespace: "web",
      catalogs: {
        web: { en: {} },
        host: { en: {} },
        strings: {
          en: { "dnd.check.perception_unusual": "You notice something unusual." },
          "zh-CN": { "dnd.check.perception_unusual": "察觉到了异常" },
        },
      },
    });
    const state = {
      transcript: [
        {
          id: "1",
          kind: "system",
          text: { i18n: { key: "dnd.check.perception_unusual" } },
          complete: true,
        },
      ],
    };
    const out = localizeSnapshot(state, en.t.bind(en)) as {
      transcript: Array<{ text: string; i18n?: unknown }>;
    };
    expect(out.transcript[0]?.text).toBe("You notice something unusual.");
    expect(out.transcript[0]?.i18n).toBeUndefined();
  });

  test("does not leak web: missing-key markers when strings catalog is absent", () => {
    const i18n = createI18n({
      locale: "zh-CN",
      defaultNamespace: "web",
      catalogs: { web: { "zh-CN": {} }, host: { "zh-CN": {} } },
    });
    const out = localizeSnapshot(
      {
        transcript: [
          {
            id: "1",
            kind: "system",
            text: { i18n: { key: "dnd.check.perception_unusual" } },
            complete: true,
          },
        ],
      },
      i18n.t.bind(i18n),
    ) as { transcript: Array<{ text: string; i18n?: unknown }> };
    expect(out.transcript[0]?.text).not.toMatch(/^web:/);
    expect(out.transcript[0]?.text).toBe("Perception Unusual");
    expect(out.transcript[0]?.i18n).toBeUndefined();
  });

  test("bindLocalizeTranslator resolves preset keys with web default namespace", () => {
    const i18n = createI18n({
      locale: "zh-CN",
      defaultNamespace: "web",
      catalogs: {
        web: { "zh-CN": {} },
        host: { "zh-CN": {} },
        strings: {
          "zh-CN": { "dnd.check.perception_unusual": "察觉到了异常" },
        },
      },
    });
    const lt = bindLocalizeTranslator(i18n.t.bind(i18n));
    const out = localizeDeep({ text: { i18n: { key: "dnd.check.perception_unusual" } } }, lt) as {
      text: string;
    };
    expect(out.text).toBe("察觉到了异常");
  });

  test("still resolves host header keys", () => {
    const i18n = createI18n({
      locale: "en",
      defaultNamespace: "web",
      catalogs: {
        web: { en: {} },
        host: { en: { "header.speaker_busy": "Speaking…" } },
      },
    });
    const out = localizeSnapshot(
      { scene: { speaker: { i18n: { key: "header.speaker_busy" } } } },
      i18n.t.bind(i18n),
    ) as { scene: { speaker: unknown } };
    expect(out.scene.speaker).toBe("Speaking…");
  });

  test("resolves keys owned by the transport's default namespace after preset and host lookups", () => {
    const i18n = createI18n({
      locale: "zh-CN",
      defaultNamespace: "web",
      catalogs: {
        web: { "zh-CN": { "error.read_only": "旁观者无法控制会话" } },
        host: { "zh-CN": {} },
        strings: { "zh-CN": {} },
      },
    });
    const lt = bindLocalizeTranslator(i18n.t.bind(i18n));
    const out = localizeDeep({ detail: { $t: "error.read_only" }, ref: { i18n: { key: "error.read_only" } } }, lt) as {
      detail: string;
      ref: string;
    };
    expect(out.detail).toBe("旁观者无法控制会话");
    expect(out.ref).toBe("旁观者无法控制会话");
  });

  test("probing with has() resolves without missing-key warnings for the namespaces that do not own the key", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const i18n = createI18n({
        locale: "zh-CN",
        defaultNamespace: "web",
        dev: true,
        catalogs: {
          web: { "zh-CN": { "error.read_only": "旁观者无法控制会话" } },
          host: { "zh-CN": { "header.speaker_busy": "正在发言…" } },
          strings: { "zh-CN": { "dnd.check.perception_unusual": "察觉到了异常" } },
        },
      });
      const lt = bindLocalizeTranslator(i18n.t.bind(i18n), i18n.has.bind(i18n));
      expect(lt("error.read_only")).toBe("旁观者无法控制会话");
      expect(lt("header.speaker_busy")).toBe("正在发言…");
      expect(lt("dnd.check.perception_unusual")).toBe("察觉到了异常");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
