import { describe, expect, test } from "bun:test";
import { AnimaeError, type Engine } from "@animae/engine";
import { SessionHost } from "../src/session-host.ts";
import type { HostAction } from "../src/types.ts";
import {
  createSessionHostTestEngine,
  sessionHostEngineNoScene,
} from "./helpers/session-host-engine-stub.ts";

describe("SessionHost commands and input", () => {
  test("runCommand opens side panel tab and runs custom command", async () => {
    const ran: string[] = [];
    const host = new SessionHost({
      engine: createSessionHostTestEngine(),
      sidePanelTabForCommand: { inspect: "debug" },
      commands: {
        inspect: {
          description: "inspect",
          run: async (args) => {
            ran.push(args.join(","));
          },
        },
      },
    });
    await host.runCommand("inspect", ["a", "b"], "req-1");
    expect(ran).toEqual(["a,b"]);
    expect(host.ui.overlay).toBe("sidePanel");
    expect(host.ui.sidePanelTab).toBe("debug");
  });

  test("submitInput colon command does not require scene", async () => {
    const host = new SessionHost({ engine: createSessionHostTestEngine() });
    await host.submitInput(":help");
    expect(host.ui.transcript.some((e) => e.kind === "system")).toBe(true);
  });

  test("submitInput rejects overlong player text", async () => {
    const host = new SessionHost({
      engine: createSessionHostTestEngine(),
    });
    host.attachScene("scn_1");
    await expect(host.submitInput("x".repeat(SessionHost.maxPlayerInputChars + 1))).rejects.toMatchObject({
      code: "INPUT_TOO_LONG",
    });
  });

  test("submitInput without scene throws NO_SCENE", async () => {
    const host = new SessionHost({ engine: sessionHostEngineNoScene() });
    await expect(host.submitInput("hello")).rejects.toMatchObject({ code: "NO_SCENE" });
  });

  test("resolveFreeInput can handle input before scene", async () => {
    const host = new SessionHost({
      engine: sessionHostEngineNoScene(),
      resolveFreeInput: async () => "handled",
    });
    await host.submitInput("go north");
    expect(host.ui.hasScene).toBe(false);
  });

  test("cancelActive clears pending flag", () => {
    const host = new SessionHost({ engine: createSessionHostTestEngine() });
    host.ui.pending = true;
    expect(host.cancelActive("r1")).toBe(true);
    expect(host.ui.pending).toBe(false);
  });

  test("runAction endday is exclusive", async () => {
    let host!: SessionHost;
    const actions: HostAction[] = [
      {
        id: "endday",
        label: "End day",
        run: async (_ctx, _args) => {
          expect(host.ui.pending).toBe(true);
        },
      },
    ];
    host = new SessionHost({ engine: createSessionHostTestEngine(), actions });
    await host.runAction("endday", {});
  });

  test("runAction entity scope requires focus", async () => {
    const host = new SessionHost({ engine: createSessionHostTestEngine(), entityActions: [] });
    await expect(host.runAction("entity:missing", {})).rejects.toMatchObject({ code: "NO_FOCUS" });
  });

  test("gallery notice unlock appends system line", async () => {
    const toasts: string[] = [];
    const host = new SessionHost({
      engine: createSessionHostTestEngine(),
      galleryNotices: { toasts: true },
    });
    host.setStreamCallbacks({ onToast: (_l, t) => toasts.push(t) });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(host.ui.transcript.some((e) => String(e.text).includes("Portrait") || typeof e.text === "object")).toBe(true);
    expect(toasts.length).toBeGreaterThan(0);
  });

  test("buildSnapshot uses header/footer hooks and panels", async () => {
    const host = new SessionHost({
      engine: createSessionHostTestEngine(),
      headerState: async () => ({ time: { day: 1, minute: 0, label: "T" } }),
      footerState: async () => ({ beat: "custom" }),
      panels: [{ id: "p1", title: "Panel", order: 1, data: async () => ({ n: 1 }) }],
    });
    host.attachScene("scn_1");
    const snap = await host.buildSnapshot({ locale: "en" });
    expect(snap.header).toEqual({ time: { day: 1, minute: 0, label: "T" } });
    expect(snap.footer).toEqual({ beat: "custom" });
    expect(snap.panels).toEqual({ p1: { n: 1 } });
  });

  test("queryPath prefers queryAsync", async () => {
    const host = new SessionHost({ engine: createSessionHostTestEngine() });
    await expect(host.queryPath("async/path")).resolves.toEqual({ ok: true });
  });

  test("overlay openOverlay splits dotted name", async () => {
    const host = new SessionHost({ engine: createSessionHostTestEngine() });
    host["commandApi"].openOverlay("sidePanel.debug");
    expect(host.ui.overlay).toBe("sidePanel");
    expect(host.ui.sidePanelTab).toBe("debug");
  });

  test("turn error localizes AnimaeError with messageKey", async () => {
    const failTurn: Engine["scene"]["turn"] = async function* () {
      throw new AnimaeError("TEST", "TEST", undefined, { messageKey: "error.no_scene", namespace: "host" });
    };
    const host = new SessionHost({
      engine: createSessionHostTestEngine({ turn: failTurn }),
    });
    host.attachScene("scn_1");
    await expect(host.submitInput("hi")).rejects.toBeInstanceOf(AnimaeError);
    expect(host.ui.turnError).toMatchObject({ i18n: { key: "host:error.no_scene" } });
  });

  test("concurrent command throws TURN_IN_PROGRESS", async () => {
    const host = new SessionHost({ engine: createSessionHostTestEngine() });
    host.ui.pending = true;
    await expect(host.runCommand("help", [])).rejects.toMatchObject({ code: "TURN_IN_PROGRESS" });
  });

  test("gallery wrappers delegate to engine", async () => {
    const host = new SessionHost({ engine: createSessionHostTestEngine() });
    expect(host.galleryGeneratorAvailable()).toBe(true);
    expect(host.galleryRatings()).toEqual([]);
    expect(await host.galleryCapture()).toEqual({ item: "i", job: "j" });
    expect(await host.galleryRender("a")).toEqual({ job: "j" });
    expect(await host.galleryCancel("j")).toBe(true);
    await host.galleryRemove("a");
    await host.galleryPin("a", true);
    host.dispose();
  });
});
