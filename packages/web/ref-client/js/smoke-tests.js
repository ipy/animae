import { findLeakedSecretKeys } from "./redact.js";

/**
 * @typedef {'pass'|'fail'|'warn'|'skip'} SmokeStatus
 * @typedef {{ id: string, status: SmokeStatus, durationMs: number, detail: string, hint?: string, advanced?: boolean }} SmokeResult
 */

/**
 * @typedef {{
 *   connect: (opts: { url: string, role: string, locale: string, token?: string, resumeSeq?: number, clientId?: string }) => Promise<void>,
 *   disconnect: () => void,
 *   send: (msg: Record<string, unknown>) => void,
 *   waitFor: (predicate: (msg: Record<string, unknown>) => boolean, timeoutMs: number) => Promise<Record<string, unknown>>,
 *   collectFor: (ms: number) => Promise<Record<string, unknown>[]>,
 *   getLastSeq: () => number,
 *   getHelloOk: () => Record<string, unknown> | null,
 *   getSnapshot: () => Record<string, unknown> | null,
 * }} SmokeTransport
 */

/** @type {SmokeTransport} */
export function createRecordingTransport(inner) {
  /** @type {Record<string, unknown>[]} */
  let inbox = [];
  /** @type {Record<string, unknown> | null} */
  let helloOk = null;
  /** @type {Record<string, unknown> | null} */
  let snapshot = null;
  let lastSeq = 0;
  const onMsg = (m) => {
    inbox.push(m);
    if (typeof m.seq === "number" && m.seq > lastSeq) lastSeq = m.seq;
    if (m.type === "hello_ok") helloOk = m;
    if (m.type === "snapshot") snapshot = m;
  };
  return {
    async connect(opts) {
      inbox = [];
      helloOk = null;
      snapshot = null;
      lastSeq = 0;
      await inner.connect({ ...opts, onMessage: onMsg });
    },
    disconnect: () => inner.disconnect(),
    send: (msg) => inner.send(msg),
    waitFor: (pred, timeoutMs) => {
      const start = inbox.length;
      return new Promise((resolve, reject) => {
        const check = () => {
          for (let i = start; i < inbox.length; i++) {
            const m = inbox[i];
            if (pred(m)) return resolve(m);
          }
          return null;
        };
        if (check()) return;
        const t0 = Date.now();
        const iv = setInterval(() => {
          const hit = check();
          if (hit) {
            clearInterval(iv);
            resolve(hit);
          } else if (Date.now() - t0 > timeoutMs) {
            clearInterval(iv);
            reject(new Error("timeout"));
          }
        }, 20);
        inner.onMessage?.((m) => {
          onMsg(m);
          const hit = check();
          if (hit) {
            clearInterval(iv);
            resolve(hit);
          }
        });
      });
    },
    collectFor(ms) {
      return new Promise((resolve) => {
        const startLen = inbox.length;
        setTimeout(() => resolve(inbox.slice(startLen)), ms);
      });
    },
    getLastSeq: () => lastSeq,
    getHelloOk: () => helloOk,
    getSnapshot: () => snapshot,
  };
}

/**
 * @param {SmokeTransport} transport
 * @param {{ url: string, role: string, locale: string, token?: string, clientId: string, nextId: () => string }} ctx
 * @param {string} [onlyId]
 */
export async function runSmokeTests(transport, ctx, onlyId) {
  const defs = smokeTestDefs(transport, ctx);
  const run = onlyId ? defs.filter((d) => d.id === onlyId) : defs;
  /** @type {SmokeResult[]} */
  const results = [];
  for (const def of run) {
    const t0 = performance.now();
    try {
      const r = await def.run();
      results.push({ ...r, durationMs: Math.round(performance.now() - t0) });
    } catch (e) {
      results.push({
        id: def.id,
        status: "fail",
        durationMs: Math.round(performance.now() - t0),
        detail: e instanceof Error ? e.message : String(e),
        hint: def.hintFail,
        advanced: def.advanced,
      });
    }
  }
  return results;
}

/**
 * @param {SmokeResult[]} results
 */
export function summarizeSmokeResults(results) {
  let pass = 0;
  let fail = 0;
  let warn = 0;
  let skip = 0;
  for (const r of results) {
    if (r.status === "pass") pass++;
    else if (r.status === "fail") fail++;
    else if (r.status === "warn") warn++;
    else skip++;
  }
  return { pass, fail, warn, skip };
}

/**
 * @param {SmokeResult[]} results
 */
export function smokeReportMarkdown(results, title = "Animae diagnostics smoke report") {
  const s = summarizeSmokeResults(results);
  const lines = [
    `# ${title}`,
    "",
    `Summary: ${s.pass} passed, ${s.warn} warning(s), ${s.fail} failed, ${s.skip} skipped`,
    "",
    "| Test | Status | ms | Detail |",
    "| --- | --- | ---: | --- |",
  ];
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.status} | ${r.durationMs} | ${r.detail.replace(/\|/g, "\\|")} |`);
    if (r.hint && r.status !== "pass") lines.push(`| | | | _Hint: ${r.hint}_ |`);
  }
  return lines.join("\n");
}

/**
 * @param {SmokeTransport} transport
 * @param {{ url: string, role: string, locale: string, token?: string, clientId: string, nextId: () => string }} ctx
 */
function smokeTestDefs(transport, ctx) {
  return [
    {
      id: "socket_open",
      hintFail: "Check the WebSocket URL, host bind address, and session token.",
      run: async () => {
        await transport.connect({
          url: ctx.url,
          role: ctx.role,
          locale: ctx.locale,
          token: ctx.token,
          clientId: ctx.clientId,
        });
        return { id: "socket_open", status: "pass", durationMs: 0, detail: "WebSocket opened within 5s" };
      },
    },
    {
      id: "hello_ok",
      hintFail: "Server must answer hello with hello_ok and protocolVersion 1.",
      run: async () => {
        await transport.connect({
          url: ctx.url,
          role: ctx.role,
          locale: ctx.locale,
          token: ctx.token,
          clientId: ctx.clientId,
        });
        const ho = await transport.waitFor((m) => m.type === "hello_ok", 5000);
        const pv = ho.protocolVersion;
        if (pv !== 1) {
          return {
            id: "hello_ok",
            status: "fail",
            durationMs: 0,
            detail: `protocolVersion=${String(pv)}`,
            hint: "Expected protocolVersion 1.",
          };
        }
        return {
          id: "hello_ok",
          status: "pass",
          durationMs: 0,
          detail: `session=${String(ho.sessionId ?? "").slice(0, 8)}… role=${String(ho.role)} locale=${String(ho.locale)}`,
        };
      },
    },
    {
      id: "snapshot_shape",
      hintFail: "Initial snapshot.state must include scene, header, actions, panels, transcript.",
      run: async () => {
        await transport.connect({
          url: ctx.url,
          role: ctx.role,
          locale: ctx.locale,
          token: ctx.token,
          clientId: ctx.clientId,
        });
        await transport.waitFor((m) => m.type === "hello_ok", 5000);
        const snap = await transport.waitFor((m) => m.type === "snapshot" && m.state, 8000);
        const st = /** @type {Record<string, unknown>} */ (snap.state);
        const need = ["protocolVersion", "scene", "header", "actions", "panels", "transcript"];
        const missing = need.filter((k) => !(k in st));
        if (missing.length) {
          return { id: "snapshot_shape", status: "fail", durationMs: 0, detail: `missing: ${missing.join(", ")}` };
        }
        if (!Array.isArray(st.actions) || typeof st.panels !== "object") {
          return { id: "snapshot_shape", status: "fail", durationMs: 0, detail: "actions/panels invalid" };
        }
        return { id: "snapshot_shape", status: "pass", durationMs: 0, detail: "snapshot fields present" };
      },
    },
    {
      id: "ping_rtt",
      hintFail: "Ping must round-trip with a pong frame.",
      run: async () => {
        await transport.connect({
          url: ctx.url,
          role: ctx.role,
          locale: ctx.locale,
          token: ctx.token,
          clientId: ctx.clientId,
        });
        await transport.waitFor((m) => m.type === "hello_ok", 5000);
        const id = ctx.nextId();
        const t0 = performance.now();
        transport.send({ v: 1, type: "ping", id });
        await transport.waitFor((m) => m.type === "pong" && m.id === id, 3000);
        const rtt = Math.round(performance.now() - t0);
        if (rtt > 3000) {
          return { id: "ping_rtt", status: "fail", durationMs: 0, detail: `RTT ${rtt}ms` };
        }
        if (rtt > 750) {
          return { id: "ping_rtt", status: "warn", durationMs: 0, detail: `RTT ${rtt}ms (high)` };
        }
        return { id: "ping_rtt", status: "pass", durationMs: 0, detail: `RTT ${rtt}ms` };
      },
    },
    {
      id: "locale_negotiation",
      hintFail: "hello_ok.locales must list the negotiated locale; set_locale to the same tag should succeed.",
      run: async () => {
        await transport.connect({
          url: ctx.url,
          role: ctx.role,
          locale: ctx.locale,
          token: ctx.token,
          clientId: ctx.clientId,
        });
        const ho = await transport.waitFor((m) => m.type === "hello_ok", 5000);
        const locales = /** @type {{ tag: string }[]} */ (ho.locales ?? []);
        if (!Array.isArray(locales) || locales.length === 0) {
          return { id: "locale_negotiation", status: "fail", durationMs: 0, detail: "locales empty" };
        }
        const negotiated = String(ho.locale ?? ctx.locale);
        if (!locales.some((l) => l.tag === negotiated)) {
          return {
            id: "locale_negotiation",
            status: "fail",
            durationMs: 0,
            detail: `negotiated ${negotiated} not in locales list`,
          };
        }
        const id = ctx.nextId();
        transport.send({ v: 1, type: "set_locale", id, locale: negotiated });
        await transport.waitFor((m) => m.type === "result" && m.id === id && m.ok === true, 5000);
        return { id: "locale_negotiation", status: "pass", durationMs: 0, detail: `locale ${negotiated} ok` };
      },
    },
    {
      id: "config_get_secrets",
      hintFail: "config_get must mask token-like keys; unmasked secrets fail this check.",
      run: async () => {
        await transport.connect({
          url: ctx.url,
          role: ctx.role,
          locale: ctx.locale,
          token: ctx.token,
          clientId: ctx.clientId,
        });
        await transport.waitFor((m) => m.type === "hello_ok", 5000);
        const id = ctx.nextId();
        transport.send({ v: 1, type: "config_get", id });
        const res = await transport.waitFor((m) => m.type === "result" && m.id === id, 5000);
        const data = /** @type {{ config?: Record<string, unknown> }} */ (res.data ?? {});
        const config = data.config;
        if (!config || typeof config !== "object") {
          return { id: "config_get_secrets", status: "fail", durationMs: 0, detail: "config not an object" };
        }
        const bad = findLeakedSecretKeys(/** @type {Record<string, unknown>} */ (config));
        if (bad.length) {
          return {
            id: "config_get_secrets",
            status: "fail",
            durationMs: 0,
            detail: `leaked keys: ${bad.join(", ")}`,
            hint: "Host configGet must mask secrets.",
          };
        }
        return { id: "config_get_secrets", status: "pass", durationMs: 0, detail: "no unmasked secret keys" };
      },
    },
    {
      id: "llm_log",
      hintFail: "llm_log should return enabled, entries, newestSeq when the host enables modelCallLog.",
      run: async () => {
        await transport.connect({
          url: ctx.url,
          role: ctx.role,
          locale: ctx.locale,
          token: ctx.token,
          clientId: ctx.clientId,
        });
        await transport.waitFor((m) => m.type === "hello_ok", 5000);
        const id = ctx.nextId();
        transport.send({ v: 1, type: "llm_log", id, limit: 1 });
        const res = await transport.waitFor((m) => m.type === "result" && m.id === id, 5000);
        const data = /** @type {{ enabled?: boolean, entries?: unknown[], newestSeq?: number }} */ (res.data ?? {});
        if (typeof data.enabled !== "boolean" || !Array.isArray(data.entries) || typeof data.newestSeq !== "number") {
          return { id: "llm_log", status: "fail", durationMs: 0, detail: "malformed llm_log payload" };
        }
        if (!data.enabled) {
          return {
            id: "llm_log",
            status: "warn",
            durationMs: 0,
            detail: "model call log disabled on host",
            hint: "Enable modelCallLog on the engine for live prompt traces.",
          };
        }
        return { id: "llm_log", status: "pass", durationMs: 0, detail: `enabled, newestSeq=${data.newestSeq}` };
      },
    },
    {
      id: "get_state_version",
      hintFail: "get_state.state.protocolVersion should match the latest snapshot.",
      run: async () => {
        await transport.connect({
          url: ctx.url,
          role: ctx.role,
          locale: ctx.locale,
          token: ctx.token,
          clientId: ctx.clientId,
        });
        await transport.waitFor((m) => m.type === "hello_ok", 5000);
        const snap = await transport.waitFor((m) => m.type === "snapshot" && m.state, 8000);
        const snapPv = /** @type {Record<string, unknown>} */ (snap.state).protocolVersion;
        const id = ctx.nextId();
        transport.send({ v: 1, type: "get_state", id });
        const res = await transport.waitFor((m) => m.type === "result" && m.id === id, 5000);
        const st = /** @type {{ state?: Record<string, unknown> }} */ (res.data ?? {}).state;
        if (!st || st.protocolVersion !== snapPv) {
          return {
            id: "get_state_version",
            status: "fail",
            durationMs: 0,
            detail: `snapshot pv=${String(snapPv)} get_state pv=${String(st?.protocolVersion)}`,
          };
        }
        return { id: "get_state_version", status: "pass", durationMs: 0, detail: `protocolVersion=${String(snapPv)}` };
      },
    },
    {
      id: "resume_quiet",
      advanced: true,
      hintFail: "After resumeSeq, only snapshot (and locale) should arrive quickly when idle—no stream/busy replay burst.",
      run: async () => {
        await transport.connect({
          url: ctx.url,
          role: ctx.role,
          locale: ctx.locale,
          token: ctx.token,
          clientId: ctx.clientId,
        });
        await transport.waitFor((m) => m.type === "snapshot", 8000);
        const resumeSeq = transport.getLastSeq();
        transport.disconnect();
        await transport.connect({
          url: ctx.url,
          role: ctx.role,
          locale: ctx.locale,
          token: ctx.token,
          resumeSeq,
          clientId: ctx.clientId,
        });
        const extra = await transport.collectFor(600);
        const noisy = extra.filter((m) => m.type === "stream" || m.type === "busy");
        if (noisy.length > 0) {
          return {
            id: "resume_quiet",
            status: "fail",
            durationMs: 0,
            detail: `unexpected ${noisy.length} stream/busy frame(s) after resume`,
            advanced: true,
          };
        }
        const allowed = new Set(["hello_ok", "locale", "snapshot", "heartbeat", "pong"]);
        const unexpected = extra.filter((m) => typeof m.type === "string" && !allowed.has(m.type));
        if (unexpected.length > 0) {
          return {
            id: "resume_quiet",
            status: "fail",
            durationMs: 0,
            detail: `unexpected frame types: ${unexpected.map((m) => String(m.type)).join(", ")}`,
            advanced: true,
          };
        }
        if (!extra.some((m) => m.type === "snapshot")) {
          return {
            id: "resume_quiet",
            status: "fail",
            durationMs: 0,
            detail: "no snapshot within 600ms after resume",
            advanced: true,
          };
        }
        return {
          id: "resume_quiet",
          status: "pass",
          durationMs: 0,
          detail: `resumeSeq=${resumeSeq}, snapshot only (no stream/busy) in 600ms`,
          advanced: true,
        };
      },
    },
  ];
}

/** @returns {{ id: string, hint?: string, advanced?: boolean }[]} */
export function smokeTestCatalog() {
  return smokeTestDefs(
    {
      connect: async () => {},
      disconnect: () => {},
      send: () => {},
      waitFor: async () => ({}),
      collectFor: async () => [],
      getLastSeq: () => 0,
      getHelloOk: () => null,
      getSnapshot: () => null,
    },
    { url: "", role: "spectator", locale: "en", clientId: "", nextId: () => "" },
  ).map((d) => ({ id: d.id, hint: d.hintFail, advanced: d.advanced }));
}
