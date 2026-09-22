import { writeModelCallLogJsonl, type ModelCallLogEntry } from "@animae/engine";
import type { HostCommandApi } from "./types.ts";

function tr(api: HostCommandApi, key: string, params?: Record<string, string | number>): string {
  return api.t?.(key, params) ?? key;
}

function formatList(entries: ModelCallLogEntry[]): string {
  return entries
    .map((e) => {
      const tok =
        e.response?.usage != null
          ? `${e.response.usage.inputTokens ?? 0}+${e.response.usage.outputTokens ?? 0}`
          : "-";
      return `#${e.seq} ${e.slot.toUpperCase()} ${e.label} ${e.modelId} ${e.timing.totalMs}ms tok=${tok} ${e.status}`;
    })
    .join("\n");
}

export async function runLlmlogCommand(args: string[], api: HostCommandApi): Promise<string | void> {
  const log = api.engine.modelCallLog;
  if (!log) {
    api.notify(tr(api, "command.llmlog_disabled"), "warn");
    return;
  }
  const sub = args[0]?.toLowerCase();
  if (sub === "dump") {
    const path = await writeModelCallLogJsonl(log, api.engine.info().root);
    return tr(api, "command.llmlog_dumped", { path });
  }
  if (sub && /^\d+$/.test(sub)) {
    const entry = log.get(Number(sub));
    if (!entry) {
      api.notify(tr(api, "command.llmlog_not_found", { seq: sub }), "warn");
      return;
    }
    const prompt = entry.request.segments.map((s) => `[${s.role}]\n${s.text}`).join("\n\n");
    const response = entry.response?.raw ?? entry.error?.message ?? "";
    return `${prompt}\n\n---\n\n${response}`;
  }
  const rows = log.list({ limit: 10 });
  if (!rows.length) return tr(api, "command.llmlog_empty");
  return formatList(rows);
}
