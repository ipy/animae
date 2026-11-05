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
        label: () => (host.uiLocale() === "fr" ? "Saluer" : "Greet"),
        hint: () => (host.uiLocale() === "fr" ? "Indice" : "Hint"),
        args: [
          {
            id: "mode",
            label: () => (host.uiLocale() === "fr" ? "Mode" : "Mode"),
            type: "enum",
            options: [{ value: "a", label: () => (host.uiLocale() === "fr" ? "Alpha-fr" : "Alpha") }],
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

    host.setUiLocale("fr");
    const fr = host.listActions()[0]!;
    expect(fr.label).toBe("Saluer");
    expect(fr.hint).toBe("Indice");
    expect(fr.args?.[0]?.options?.[0]?.label).toBe("Alpha-fr");

    const snap = (await host.buildSnapshot({ locale: "en" })).actions as Array<{ label: string }>;
    expect(snap[0]?.label).toBe("Greet");
  });
});
