import { describe, expect, test } from "bun:test";
import { createI18n } from "@animae/i18n";
import { localizeSnapshot } from "../src/localize-snapshot.ts";

describe("localizeSnapshot actions and turnError", () => {
  const i18n = createI18n({
    locale: "en",
    defaultNamespace: "web",
    catalogs: {
      web: { en: {} },
      host: { en: { "action.greet": "Say hello", "action.hint": "Wave", "opt.a": "Option A" } },
      strings: { en: { "error.turn_failed": "Turn failed: {reason}" } },
    },
  });
  const t = i18n.t.bind(i18n);
  const has = i18n.has.bind(i18n);

  test("localizes action labels, hints, args, and options", () => {
    const out = localizeSnapshot(
      {
        actions: [
          {
            id: "greet",
            label: { i18n: { key: "action.greet" } },
            hint: { i18n: { key: "action.hint" } },
            args: [
              {
                id: "mode",
                label: { i18n: { key: "action.greet" } },
                options: [{ value: "a", label: { i18n: { key: "opt.a" } } }],
              },
            ],
          },
        ],
      },
      t,
      has,
    ) as {
      actions: Array<{
        label: string;
        hint: string;
        labelI18n?: unknown;
        args: Array<{ label: string; labelI18n?: unknown; options: Array<{ label: string; labelI18n?: unknown }> }>;
      }>;
    };
    expect(out.actions[0]?.label).toBe("Say hello");
    expect(out.actions[0]?.hint).toBe("Wave");
    expect(out.actions[0]?.labelI18n).toBeUndefined();
    expect(out.actions[0]?.args[0]?.label).toBe("Say hello");
    expect(out.actions[0]?.args[0]?.options[0]?.label).toBe("Option A");
  });

  test("turnError with i18n ref sets turnErrorI18n when unresolved", () => {
    const out = localizeSnapshot(
      { turnError: { i18n: { key: "error.turn_failed", params: { reason: "x" } } } },
      t,
      has,
    ) as { turnError: string; turnErrorI18n?: unknown };
    expect(out.turnError).toContain("Turn failed");
    expect(out.turnErrorI18n).toBeUndefined();
  });

  test("plain string turnError passes through", () => {
    const out = localizeSnapshot({ turnError: "boom" }, t, has) as { turnError: string };
    expect(out.turnError).toBe("boom");
  });
});
