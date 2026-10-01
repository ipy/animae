// @ts-nocheck
import { expect, test } from "bun:test";
import { runSmokeTests, summarizeSmokeResults, smokeReportMarkdown } from "../ref-client/js/smoke-tests.js";

function fakeTransport() {
  /** @type {Record<string, unknown>[]} */
  let inbox: Record<string, unknown>[] = [];
  let seq = 0;
  let connected = false;
  const push = (m: Record<string, unknown>) => {
    if (typeof m.seq === "number") seq = m.seq;
    inbox.push(m);
  };

  return {
    transport: {
      async connect() {
        inbox = [];
        seq = 0;
        connected = true;
        push({
          v: 1,
          type: "hello_ok",
          seq: ++seq,
          sessionId: "s",
          role: "spectator",
          protocolVersion: 1,
          locale: "en",
          locales: [{ tag: "en", name: "English" }],
          controllerPresent: false,
        });
        push({
          v: 1,
          type: "snapshot",
          seq: ++seq,
          state: {
            protocolVersion: 1,
            scene: { active: true, location: "x" },
            header: { time: { label: "d1" } },
            actions: [],
            panels: {},
            transcript: [],
          },
        });
      },
      disconnect() {
        connected = false;
      },
      send(msg: Record<string, unknown>) {
        if (msg.type === "ping") {
          push({ v: 1, type: "pong", seq: ++seq, id: msg.id });
        }
        if (msg.type === "set_locale") {
          push({ v: 1, type: "result", id: msg.id, ok: true, data: { locale: "en" } });
        }
        if (msg.type === "config_get") {
          push({ v: 1, type: "result", id: msg.id, ok: true, data: { config: { theme: "dark", apiKey: "••••" } } });
        }
        if (msg.type === "llm_log") {
          push({
            v: 1,
            type: "result",
            id: msg.id,
            ok: true,
            data: { enabled: true, entries: [], newestSeq: 0 },
          });
        }
        if (msg.type === "get_state") {
          push({
            v: 1,
            type: "result",
            id: msg.id,
            ok: true,
            data: {
              state: {
                protocolVersion: 1,
                scene: {},
                header: {},
                actions: [],
                panels: {},
                transcript: [],
              },
            },
          });
        }
      },
      waitFor(pred: (m: Record<string, unknown>) => boolean, timeoutMs: number) {
        const existing = inbox.find(pred);
        if (existing) return Promise.resolve(existing);
        const startLen = inbox.length;
        return new Promise((resolve, reject) => {
          const t0 = Date.now();
          const iv = setInterval(() => {
            for (let i = startLen; i < inbox.length; i++) {
              const m = inbox[i]!;
              if (pred(m)) {
                clearInterval(iv);
                resolve(m);
                return;
              }
            }
            if (Date.now() - t0 > timeoutMs) {
              clearInterval(iv);
              reject(new Error("timeout"));
            }
          }, 5);
        });
      },
      collectFor(_ms: number) {
        return Promise.resolve(inbox.filter((m) => m.type === "stream" || m.type === "busy"));
      },
      getLastSeq: () => seq,
      getHelloOk: () => inbox.find((m) => m.type === "hello_ok") ?? null,
      getSnapshot: () => inbox.find((m) => m.type === "snapshot") ?? null,
    },
    get connected() {
      return connected;
    },
  };
}

test("runSmokeTests core checks pass on fake transport", async () => {
  const { transport } = fakeTransport();
  const ctx = {
    url: "ws://fake",
    role: "spectator",
    locale: "en",
    clientId: "c1",
    nextId: () => "r1",
  };
  const results = await runSmokeTests(transport, ctx, "ping_rtt");
  expect(results[0]?.status).toBe("pass");
});

test("summarize and markdown report", () => {
  const sum = summarizeSmokeResults([
    { id: "a", status: "pass", durationMs: 1, detail: "ok" },
    { id: "b", status: "fail", durationMs: 2, detail: "no" },
  ]);
  expect(sum.pass).toBe(1);
  expect(sum.fail).toBe(1);
  expect(smokeReportMarkdown([])).toContain("Summary");
});
