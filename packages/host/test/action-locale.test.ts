import { describe, expect, test } from "bun:test";
import type { HostAction } from "../src/types.ts";
import { SessionHost } from "../src/session-host.ts";

function stubEngine() {
  return {
    gallery: { subscribe: () => () => {}, list: async () => [], get: async () => undefined },
    on: () => () => {},
    query: () => undefined,
    world: { now: () => ({ day: 1, minute: 0 }) },
    scene: { active: () => null },
    mods: () => null,
    timeline: { current: () => ({ name: "main" }) },
  } as unknown as SessionHost["engine"];
}

describe("SessionHost.listActions locale", () => {
  test("plain string labels pass through unchanged", async () => {
    const actions: HostAction[] = [{ id: "plain", label: "Plain label", run: async () => {} }];
    const host = new SessionHost({ engine: stubEngine(), actions, uiLocale: "en" });
    expect(host.listActions()[0]?.label).toBe("Plain label");
  });

  test("deferred labels follow viewer locale and set_locale refresh", async () => {
    let host!: SessionHost;
    const actions: HostAction[] = [
      {
        id: "greet",
        label: () => (host.uiLocale() === "zh-CN" ? "问候" : "Greet"),
        hint: () => (host.uiLocale() === "zh-CN" ? "提示" : "Hint"),
        args: [
          {
            id: "mode",
            label: () => (host.uiLocale() === "zh-CN" ? "模式" : "Mode"),
            type: "enum",
            options: [{ value: "a", label: () => (host.uiLocale() === "zh-CN" ? "甲" : "Alpha") }],
          },
        ],
        run: async () => {},
      },
    ];
    host = new SessionHost({ engine: stubEngine(), actions, uiLocale: "en" });
    const en = host.listActions()[0]!;
    expect(en.label).toBe("Greet");
    expect(en.hint).toBe("Hint");
    expect(en.args?.[0]?.label).toBe("Mode");
    expect(en.args?.[0]?.options?.[0]?.label).toBe("Alpha");

    host.setUiLocale("zh-CN");
    const zh = host.listActions()[0]!;
    expect(zh.label).toBe("问候");
    expect(zh.hint).toBe("提示");
    expect(zh.args?.[0]?.options?.[0]?.label).toBe("甲");

    const snap = (await host.buildSnapshot({ locale: "en" })).actions as Array<{ label: string }>;
    expect(snap[0]?.label).toBe("Greet");
  });
});
