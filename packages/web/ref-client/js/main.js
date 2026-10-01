import { detectDefaultLocale, loadCatalog, currentLocale, t, applyDocumentI18n } from "./i18n.js";
import { SessionTransport } from "./session-transport.js";
import { pushProtocolFrame, filterProtocolFeed } from "./protocol-feed.js";
import { redactValue } from "./redact.js";
import { buildJsonTree, jsonTreeMatches } from "./json-tree.js";
import {
  filterLlmEntries,
  entriesToJsonl,
  formatTokens,
  mergeLlmEntriesBySeq,
  fetchAllLlmLogEntries,
} from "./llm-log-lib.js";
import {
  runSmokeTests,
  summarizeSmokeResults,
  smokeReportMarkdown,
  smokeTestCatalog,
} from "./smoke-tests.js";
import { copyText } from "./copy.js";

const qs = new URLSearchParams(location.search);
const defaultWs =
  qs.get("ws") ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const authToken = qs.get("token") || "";
const queryRole = qs.get("role");
const queryLocale = qs.get("locale");

const CLIENT_ID_KEY = "animae.clientId";
const THEME_KEY = "animae.ref.theme";
const clientId = localStorage.getItem(CLIENT_ID_KEY) || `ref-${crypto.randomUUID().slice(0, 8)}`;
localStorage.setItem(CLIENT_ID_KEY, clientId);

/** @type {Record<string, unknown>[]} */
const protocolBuffer = [];
let protocolPaused = false;
/** @type {import('./smoke-tests.js').SmokeResult[]} */
let lastSmokeResults = [];

/** @type {unknown[]} */
let llmEntries = [];
let llmEnabled = true;
let llmNewestSeq = 0;
let llmSelectedSeq = null;
let llmPollTimer = null;

const el = {
  pill: document.getElementById("conn-pill"),
  pillText: document.getElementById("conn-pill-text"),
  localeSelect: document.getElementById("locale-select"),
  themeToggle: document.getElementById("theme-toggle"),
  wsUrl: document.getElementById("ws-url"),
  wsRole: document.getElementById("ws-role"),
  autoReconnect: document.getElementById("auto-reconnect"),
  btnConnect: document.getElementById("btn-connect"),
  btnDisconnect: document.getElementById("btn-disconnect"),
  metaSession: document.getElementById("meta-session"),
  metaProtocol: document.getElementById("meta-protocol"),
  metaLocale: document.getElementById("meta-locale"),
  metaLocales: document.getElementById("meta-locales"),
  metaController: document.getElementById("meta-controller"),
  liveRegion: document.getElementById("live-region"),
  overviewList: document.getElementById("overview-test-list"),
  smokeResults: document.getElementById("smoke-results"),
  smokeBanner: document.getElementById("smoke-banner"),
  stateCards: document.getElementById("state-cards"),
  stateTree: document.getElementById("state-tree"),
  stateFilter: document.getElementById("state-filter"),
  protocolFeed: document.getElementById("protocol-feed"),
  protocolTypeFilter: document.getElementById("protocol-type-filter"),
  protocolBody: document.getElementById("protocol-body"),
  protocolExpanded: document.getElementById("protocol-expanded"),
  llmTbody: document.getElementById("llm-tbody"),
  llmDetail: document.getElementById("llm-detail"),
  envList: document.getElementById("env-list"),
};

const transport = new SessionTransport(clientId, (dir, msg) => {
  if (!protocolPaused) pushProtocolFrame(protocolBuffer, msg, dir);
  refreshProtocolFeed();
  if (msg.type === "hello_ok") updateHelloMeta(msg);
  if (msg.type === "snapshot") renderStateTab(msg);
  if (msg.type === "locale" && transport.connected) {
    el.localeSelect.value = String(msg.locale);
  }
  updateConnectionUi();
});

function announce(msg) {
  if (el.liveRegion) el.liveRegion.textContent = msg;
}

function setConnState(state) {
  el.pill.dataset.state = state;
  const key =
    state === "connected" ? "status.connected" : state === "connecting" ? "status.connecting" : "status.disconnected";
  el.pillText.textContent = t(key);
}

function updateConnectionUi() {
  const connected = transport.connected;
  el.btnConnect.disabled = connected;
  el.btnDisconnect.disabled = !connected;
  const isController = transport.role === "controller";
  document.querySelectorAll("#panel-console button, #panel-console input, #panel-console textarea").forEach((node) => {
    if (node.id === "console-send-input" || node.id === "console-send-cmd" || node.id === "console-send-raw") {
      node.disabled = !connected || !isController;
    }
  });
}

function updateHelloMeta(ho) {
  el.metaSession.textContent = String(ho.sessionId ?? "—");
  el.metaProtocol.textContent = String(ho.protocolVersion ?? "—");
  el.metaLocale.textContent = String(ho.locale ?? "—");
  const locales = /** @type {{ tag: string, name: string }[]} */ (ho.locales ?? []);
  el.metaLocales.textContent = locales.map((l) => `${l.tag} (${l.name})`).join(", ") || "—";
  el.metaController.textContent = ho.controllerPresent ? t("conn.controllerPresent") : t("conn.controllerFree");
}

async function connectSession() {
  setConnState("connecting");
  announce(t("status.connecting"));
  try {
    await transport.connect({
      url: el.wsUrl.value.trim(),
      role: el.wsRole.value,
      locale: el.localeSelect.value,
      token: authToken || undefined,
      clientId,
    });
    setConnState("connected");
    announce(t("status.connected"));
    if (transport.helloOk) updateHelloMeta(transport.helloOk);
    if (transport.snapshot) renderStateTab(transport.snapshot);
  } catch {
    setConnState("disconnected");
    announce(t("status.disconnected"));
  }
  updateConnectionUi();
}

function disconnectSession() {
  transport.disconnect();
  setConnState("disconnected");
  announce(t("status.disconnected"));
  updateConnectionUi();
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") {
    document.documentElement.dataset.theme = stored;
  }
  syncThemeButton();
}

function syncThemeButton() {
  const dark =
    document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  el.themeToggle.querySelector("span").textContent = dark ? t("theme.light") : t("theme.dark");
}

function toggleTheme() {
  const dark =
    document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  syncThemeButton();
}

function initTabs() {
  const tabs = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[role="tab"]')]);
  const panels = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[role="tabpanel"]')]);

  const activate = (id) => {
    for (const tab of tabs) {
      const on = tab.id === id;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    }
    const panelId = tabs.find((t) => t.id === id)?.getAttribute("aria-controls");
    for (const p of panels) {
      p.dataset.active = p.id === panelId ? "true" : "false";
    }
    if (id === "tab-llm") startLlmPoll();
    else stopLlmPoll();
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activate(tab.id));
    tab.addEventListener("keydown", (ev) => {
      const idx = tabs.indexOf(tab);
      if (ev.key === "ArrowRight") tabs[(idx + 1) % tabs.length].focus();
      if (ev.key === "ArrowLeft") tabs[(idx - 1 + tabs.length) % tabs.length].focus();
    });
  });
}

async function fetchEnvironment() {
  if (!el.envList) return;
  el.envList.dataset.state = "loading";
  el.envList.innerHTML = `<p class="empty-state">${escapeHtml(t("common.loading"))}</p>`;
  const params = new URLSearchParams({ locale: currentLocale() });
  if (authToken) params.set("token", authToken);
  try {
    const res = await fetch(`/api/environment?${params.toString()}`, {
      headers: authToken ? { "X-Animae-Token": authToken } : {},
    });
    if (res.status === 404) {
      el.envList.dataset.state = "empty";
      el.envList.innerHTML = `<p class="empty-state">${escapeHtml(t("env.unavailable"))}</p>`;
      return;
    }
    if (!res.ok) {
      el.envList.dataset.state = "error";
      el.envList.innerHTML = `<p class="empty-state">${escapeHtml(t("env.loadError"))}</p>`;
      return;
    }
    const data = /** @type {{ entries?: { id: string, label: string, value: string, kind?: string }[] }} */ (
      await res.json()
    );
    renderEnvironmentList(data.entries ?? []);
  } catch {
    el.envList.dataset.state = "error";
    el.envList.innerHTML = `<p class="empty-state">${escapeHtml(t("env.loadError"))}</p>`;
  }
}

function renderEnvironmentList(entries) {
  if (!el.envList) return;
  if (!entries.length) {
    el.envList.dataset.state = "empty";
    el.envList.innerHTML = `<p class="empty-state">${escapeHtml(t("env.unavailable"))}</p>`;
    return;
  }
  el.envList.dataset.state = "ready";
  el.envList.innerHTML = "";
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "env-row";
    const label = document.createElement("p");
    label.className = "env-row-label";
    const labelKey = `env.${entry.id}`;
    label.textContent = t(labelKey) !== labelKey ? t(labelKey) : entry.label || entry.id;
    const value = document.createElement("p");
    value.className = "env-row-value";
    value.textContent = entry.value;
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = t("common.copy");
    copyBtn.addEventListener("click", async () => {
      const ok = await copyText(entry.value);
      if (ok) announce(t("common.copied"));
    });
    row.append(label, value, copyBtn);
    el.envList.appendChild(row);
  }
}

function renderOverviewTests() {
  el.overviewList.innerHTML = "";
  for (const item of smokeTestCatalog()) {
    const li = document.createElement("li");
    li.className = "smoke-item";
    const key = `smoke.desc.${item.id}`;
    li.innerHTML = `<strong>${escapeHtml(item.id)}</strong>${item.advanced ? ` <span class="badge skip">${t("smoke.advanced")}</span>` : ""}<br /><span data-i18n="${key}">${t(key)}</span>`;
    el.overviewList.appendChild(li);
  }
}

function renderSmokeResults(results) {
  lastSmokeResults = results;
  el.smokeResults.innerHTML = "";
  const sum = summarizeSmokeResults(results);
  el.smokeBanner.hidden = false;
  el.smokeBanner.textContent = t("smoke.summary", {
    pass: sum.pass,
    warn: sum.warn,
    fail: sum.fail,
    skip: sum.skip,
  });
  el.smokeBanner.className = `banner ${sum.fail ? "fail" : sum.warn ? "warn" : "ok"}`;

  for (const r of results) {
    const li = document.createElement("li");
    li.className = "smoke-item";
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.innerHTML = `<span class="badge ${escapeHtml(r.status)}">${t(`smoke.status.${r.status}`)}</span> <code>${escapeHtml(r.id)}</code> <span>${escapeHtml(r.durationMs)} ms</span>`;
    if (r.advanced) summary.innerHTML += ` <span class="badge skip">${t("smoke.advanced")}</span>`;
    summary.innerHTML += `<button type="button" class="smoke-run-one" data-id="${escapeHtml(r.id)}">${t("smoke.run")}</button>`;
    const detail = document.createElement("div");
    detail.className = "detail";
    detail.textContent = r.detail;
    if (r.hint && r.status !== "pass") {
      const hint = document.createElement("p");
      hint.textContent = `${t("smoke.hint")}: ${r.hint}`;
      detail.appendChild(hint);
    }
    details.appendChild(summary);
    details.appendChild(detail);
    li.appendChild(details);
    el.smokeResults.appendChild(li);
  }

  el.smokeResults.querySelectorAll(".smoke-run-one").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void runSmoke(String(/** @type {HTMLButtonElement} */ (btn).dataset.id));
    });
  });
}

async function runSmoke(onlyId) {
  const smokeTransport = transport.asSmokeTransport();
  const ctx = {
    url: el.wsUrl.value.trim(),
    role: "spectator",
    locale: el.localeSelect.value,
    token: authToken || undefined,
    clientId: `${clientId}-smoke-${Date.now()}`,
    nextId: () => transport.nextId(),
  };
  transport.disconnect();
  const results = await runSmokeTests(smokeTransport, ctx, onlyId);
  renderSmokeResults(results);
  if (el.autoReconnect.checked) await connectSession();
}

function refreshProtocolFeed() {
  const typeFilter = el.protocolTypeFilter.value || null;
  const rows = filterProtocolFeed(protocolBuffer, typeFilter);
  el.protocolFeed.innerHTML = "";
  for (const row of rows.slice().reverse()) {
    const div = document.createElement("div");
    div.className = "protocol-row";
    div.innerHTML = `<span class="dir-${row.direction === "in" ? "in" : "out"}">${row.direction === "in" ? "←" : "→"}</span><span>${escapeHtml(row.type)}</span><span>${escapeHtml(row.seq ?? "—")}</span><span>${escapeHtml(row.size)} B</span><span>${new Date(row.at).toLocaleTimeString()}</span>`;
    div.addEventListener("click", () => {
      el.protocolExpanded.hidden = false;
      el.protocolBody.textContent = JSON.stringify(row.body, null, 2);
    });
    el.protocolFeed.appendChild(div);
  }
  const types = [...new Set(protocolBuffer.map((r) => r.type))].sort();
  const current = el.protocolTypeFilter.value;
  el.protocolTypeFilter.innerHTML = `<option value="">${t("protocol.allTypes")}</option>`;
  for (const ty of types) {
    const opt = document.createElement("option");
    opt.value = ty;
    opt.textContent = ty;
    el.protocolTypeFilter.appendChild(opt);
  }
  el.protocolTypeFilter.value = current;
}

function renderStateTab(snap) {
  const st = snap.state;
  if (!st || typeof st !== "object") return;
  const scene = /** @type {Record<string, unknown>} */ (st).scene ?? {};
  const header = /** @type {Record<string, unknown>} */ (st).header ?? {};
  const time = /** @type {Record<string, unknown>} */ (header).time ?? {};
  const roster = /** @type {unknown[]} */ (st).roster ?? [];
  const panels = /** @type {Record<string, unknown>} */ (st).panels ?? {};
  el.stateCards.innerHTML = `
    <div class="card-mini"><span>${t("state.scene")}</span>${scene.active ? t("state.sceneActive") : t("state.sceneIdle")}</div>
    <div class="card-mini"><span>${t("state.location")}</span>${escapeHtml(scene.location ?? "—")}</div>
    <div class="card-mini"><span>${t("state.time")}</span>${escapeHtml(time.label ?? "—")}</div>
    <div class="card-mini"><span>${t("state.roster")}</span>${roster.length}</div>
    <div class="card-mini"><span>${t("state.pending")}</span>${st.pending ? t("common.yes") : t("common.no")}</div>
    <div class="card-mini"><span>${t("state.panels")}</span>${escapeHtml(Object.keys(panels).join(", ") || "—")}</div>`;
  const filter = el.stateFilter.value;
  if (!jsonTreeMatches(st, filter)) {
    el.stateTree.innerHTML = `<p class="empty-state">${t("state.search")}</p>`;
    return;
  }
  const tree = buildJsonTree(redactValue(st), "state");
  el.stateTree.innerHTML = tree.html;
}

async function fetchLlmLog(since) {
  if (!transport.connected) return;
  const id = transport.nextId();
  transport.send({
    v: 1,
    type: "llm_log",
    id,
    limit: 50,
    ...(since ? { since } : {}),
    ...(document.getElementById("llm-slot").value ? { slot: document.getElementById("llm-slot").value } : {}),
    ...(document.getElementById("llm-label").value.trim()
      ? { label: document.getElementById("llm-label").value.trim() }
      : {}),
    ...(document.getElementById("llm-errors-only").checked ? { errorsOnly: true } : {}),
  });
  try {
    const res = await transport.waitFor((m) => m.type === "result" && m.id === id, 8000);
    const data = /** @type {{ enabled?: boolean, entries?: unknown[], newestSeq?: number }} */ (res.data ?? {});
    llmEnabled = data.enabled !== false;
    const batch = data.entries ?? [];
    if (since) {
      llmEntries = mergeLlmEntriesBySeq(llmEntries, batch);
    } else {
      llmEntries = batch;
    }
    llmNewestSeq = typeof data.newestSeq === "number" ? data.newestSeq : llmNewestSeq;
    renderLlmTable();
  } catch {
    /* ignore */
  }
}

function renderLlmTable() {
  if (!llmEnabled) {
    el.llmTbody.innerHTML = "";
    el.llmDetail.innerHTML = `<p class="empty-state">${t("llm.disabled")}</p>`;
    return;
  }
  const filters = {
    slot: document.getElementById("llm-slot").value || undefined,
    label: document.getElementById("llm-label").value,
    errorsOnly: document.getElementById("llm-errors-only").checked,
  };
  const rows = filterLlmEntries(/** @type {never[]} */ (llmEntries), filters);
  el.llmTbody.innerHTML = "";
  if (!rows.length) {
    el.llmDetail.innerHTML = `<p class="empty-state">${t("llm.empty")}</p>`;
    return;
  }
  for (const entry of rows) {
    const tr = document.createElement("tr");
    if (entry.seq === llmSelectedSeq) tr.dataset.selected = "true";
    const lat = entry.timing?.totalMs != null ? `${entry.timing.totalMs} ms` : "—";
    tr.innerHTML = `<td>${escapeHtml(entry.seq)}</td><td>${new Date(entry.startedAt).toLocaleTimeString()}</td><td><span class="chip">${escapeHtml(entry.slot)}</span></td><td>${escapeHtml(entry.label)}</td><td>${escapeHtml(entry.modelId)}</td><td>${escapeHtml(formatTokens(entry))}</td><td>${escapeHtml(lat)}</td><td><span class="chip ${escapeHtml(entry.status)}">${t(`llm.status.${entry.status}`)}</span></td>`;
    tr.addEventListener("click", () => {
      llmSelectedSeq = entry.seq;
      renderLlmDetail(entry);
      renderLlmTable();
    });
    el.llmTbody.appendChild(tr);
  }
  if (!llmSelectedSeq && rows[0]) {
    llmSelectedSeq = rows[0].seq;
    renderLlmDetail(rows[0]);
  }
}

function renderLlmDetail(entry) {
  const parts = [];
  parts.push(`<h4>${t("llm.detailTitle")} #${escapeHtml(entry.seq)}</h4>`);
  parts.push(`<h5>${t("llm.segments")}</h5>`);
  for (const seg of entry.request?.segments ?? []) {
    parts.push(
      `<details><summary>${escapeHtml(seg.role)}${seg.truncated ? ` (${t("llm.truncated")})` : ""}</summary><pre>${escapeHtml(seg.text)}</pre><button type="button" class="copy-seg">${t("common.copy")}</button></details>`,
    );
  }
  if (entry.response?.raw) {
    parts.push(`<h5>${t("llm.responseRaw")}</h5><pre>${escapeHtml(entry.response.raw)}</pre>`);
  }
  if (entry.response?.final != null) {
    parts.push(
      `<h5>${t("llm.responseParsed")}</h5><pre>${escapeHtml(JSON.stringify(entry.response.final, null, 2))}</pre>`,
    );
  }
  parts.push(`<h5>${t("llm.usage")}</h5><pre>${escapeHtml(JSON.stringify(entry.response?.usage ?? {}, null, 2))}</pre>`);
  parts.push(`<h5>${t("llm.timing")}</h5><pre>${escapeHtml(JSON.stringify(entry.timing ?? {}, null, 2))}</pre>`);
  parts.push(`<h5>${t("llm.params")}</h5><pre>${escapeHtml(JSON.stringify(entry.request?.params ?? {}, null, 2))}</pre>`);
  if (entry.response?.toolCalls?.length) {
    parts.push(`<h5>${t("llm.toolCalls")}</h5><pre>${escapeHtml(JSON.stringify(entry.response.toolCalls, null, 2))}</pre>`);
  }
  el.llmDetail.innerHTML = parts.join("");
  el.llmDetail.querySelectorAll(".copy-seg").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      const seg = entry.request.segments[i];
      void navigator.clipboard.writeText(seg.text);
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function startLlmPoll() {
  stopLlmPoll();
  if (!document.getElementById("llm-live").checked) return;
  void fetchLlmLog();
  llmPollTimer = window.setInterval(() => {
    if (document.getElementById("panel-llm").dataset.active === "true") {
      void fetchLlmLog(llmNewestSeq);
    }
  }, 2000);
}

function stopLlmPoll() {
  if (llmPollTimer) window.clearInterval(llmPollTimer);
  llmPollTimer = null;
}

async function init() {
  initTheme();
  const loc = queryLocale ? (queryLocale === "zh-CN" ? "zh-CN" : "en") : detectDefaultLocale();
  el.localeSelect.value = loc;
  await loadCatalog(loc);
  applyDocumentI18n();

  el.wsUrl.value = defaultWs;
  if (queryRole === "controller" || queryRole === "spectator") el.wsRole.value = queryRole;

  renderOverviewTests();
  void fetchEnvironment();
  initTabs();
  setConnState("disconnected");
  updateConnectionUi();

  el.themeToggle.addEventListener("click", toggleTheme);
  el.localeSelect.addEventListener("change", async () => {
    await loadCatalog(el.localeSelect.value);
    applyDocumentI18n();
    renderOverviewTests();
    void fetchEnvironment();
    if (transport.connected) {
      const id = transport.nextId();
      transport.send({ v: 1, type: "set_locale", id, locale: el.localeSelect.value });
    }
  });

  el.btnConnect.addEventListener("click", () => void connectSession());
  el.btnDisconnect.addEventListener("click", disconnectSession);

  document.getElementById("smoke-run-all").addEventListener("click", () => void runSmoke());
  document.getElementById("smoke-rerun-failed").addEventListener("click", () => {
    const failed = lastSmokeResults.filter((r) => r.status === "fail").map((r) => r.id);
    if (!failed.length) return;
    void (async () => {
      for (const id of failed) await runSmoke(id);
    })();
  });
  document.getElementById("smoke-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(smokeReportMarkdown(lastSmokeResults));
    announce(t("common.copied"));
  });
  document.getElementById("smoke-download").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(lastSmokeResults, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "animae-smoke-report.json";
    a.click();
  });

  el.stateFilter.addEventListener("input", () => {
    if (transport.snapshot) renderStateTab(transport.snapshot);
  });
  document.getElementById("state-copy").addEventListener("click", async () => {
    const st = transport.snapshot?.state;
    if (!st) return;
    await navigator.clipboard.writeText(JSON.stringify(redactValue(st), null, 2));
    announce(t("common.copied"));
  });

  document.getElementById("protocol-pause").addEventListener("click", (ev) => {
    protocolPaused = !protocolPaused;
    /** @type {HTMLButtonElement} */ (ev.currentTarget).textContent = protocolPaused ? t("protocol.resume") : t("protocol.pause");
  });
  document.getElementById("protocol-clear").addEventListener("click", () => {
    protocolBuffer.length = 0;
    refreshProtocolFeed();
  });

  document.getElementById("llm-refresh").addEventListener("click", () => void fetchLlmLog());
  document.getElementById("llm-live").addEventListener("change", startLlmPoll);
  ["llm-slot", "llm-label", "llm-errors-only"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      void fetchLlmLog();
    });
    document.getElementById(id).addEventListener("input", () => renderLlmTable());
  });
  document.getElementById("llm-export").addEventListener("click", async () => {
    if (!transport.connected) return;
    const { enabled, entries } = await fetchAllLlmLogEntries(async (since) => {
      const id = transport.nextId();
      transport.send({
        v: 1,
        type: "llm_log",
        id,
        limit: 50,
        ...(since != null ? { since } : {}),
      });
      const res = await transport.waitFor((m) => m.type === "result" && m.id === id, 8000);
      const data = /** @type {{ enabled?: boolean, entries?: unknown[], newestSeq?: number }} */ (res.data ?? {});
      return {
        enabled: data.enabled !== false,
        entries: data.entries ?? [],
        newestSeq: typeof data.newestSeq === "number" ? data.newestSeq : 0,
      };
    });
    if (!enabled) {
      announce(t("llm.disabled"));
      return;
    }
    const body = entriesToJsonl(entries);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "application/x-ndjson" }));
    a.download = "model-calls.jsonl";
    a.click();
  });
  document.getElementById("llm-clear").addEventListener("click", async () => {
    if (!confirm(t("llm.clearConfirm"))) return;
    const id = transport.nextId();
    transport.send({ v: 1, type: "llm_log_clear", id });
    await transport.waitFor((m) => m.type === "result" && m.id === id, 5000).catch(() => {});
    llmEntries = [];
    llmSelectedSeq = null;
    void fetchLlmLog();
  });

  document.getElementById("console-send-input").addEventListener("click", () => {
    const text = document.getElementById("console-input").value.trim();
    if (!text) return;
    transport.send({ v: 1, type: "input", id: transport.nextId(), text });
  });
  document.getElementById("console-send-cmd").addEventListener("click", () => {
    const name = document.getElementById("console-cmd-name").value.trim();
    if (!name) return;
    const args = document.getElementById("console-cmd-args").value.trim().split(/\s+/).filter(Boolean);
    transport.send({ v: 1, type: "command", id: transport.nextId(), name, args });
  });
  document.getElementById("console-send-raw").addEventListener("click", () => {
    try {
      const raw = JSON.parse(document.getElementById("console-raw").value);
      if (typeof raw !== "object" || !raw) throw new Error("object");
      if (raw.v == null) raw.v = 1;
      if (raw.id == null && raw.type !== "hello") raw.id = transport.nextId();
      transport.send(raw);
    } catch {
      announce(t("console.invalidJson"));
    }
  });

  el.protocolTypeFilter.addEventListener("change", refreshProtocolFeed);
}

void init();
