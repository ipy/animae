import { RUNTIME_MODE_PRESETS, parseModeRequest, runtimeModePresetOf } from "@animae/engine";
import type { CommandApi } from "../types.ts";
import { formatMode, hasRuntime } from "../utils/mode-display.ts";
import { requestMode, type ModeSwitchOutcome } from "../utils/mode-switch.ts";

type Params = Record<string, string | number>;

function msg(api: CommandApi, key: string, params?: Params): string {
  const t = api.t ?? ((k: string) => k);
  return t(key, params);
}

/** What the player should be told about an outcome (`applied` is announced by the `runtime.mode_changed` event). */
export function describeModeOutcome(outcome: ModeSwitchOutcome, api: Pick<CommandApi, "t">): string | undefined {
  const t = (key: string, params?: Params) => (api.t ?? ((k: string) => k))(key, params);
  switch (outcome.kind) {
    case "unsupported":
      return t("mode.unsupported");
    case "unchanged":
      return t("mode.unchanged", { mode: `[${outcome.mode}]` });
    case "queued":
      return t("mode.queued_note", { mode: `[${outcome.after}]` });
    case "applied":
      return undefined;
  }
}

/** `:mode s1 llm|rule`, `:mode s2 llm|rule|<tier>`, `:mode <preset>`; `:mode` opens the panel, `:mode status` prints. */
export async function runModeCommand(args: string[], api: CommandApi): Promise<string | void> {
  if (args.length === 0) {
    api.openOverlay("mode");
    return;
  }
  const engine = api.engine;
  if (!hasRuntime(engine)) return msg(api, "mode.unsupported");

  const head = (args[0] ?? "").toLowerCase();
  if (head === "status") {
    const mode = engine.runtime.mode();
    const models = engine.runtime.models();
    return msg(api, "mode.status", {
      mode: `[${formatMode(mode, models)}]`,
      preset: runtimeModePresetOf(mode),
      presets: RUNTIME_MODE_PRESETS.join(", "),
      tiers: models.s2Tiers.map((tier) => tier.id).join(", ") || "—",
    });
  }

  const request = parseModeRequest(args);
  if (!request) return msg(api, "mode.usage");
  return describeModeOutcome(await requestMode(engine, request, "tui:mode-command"), api);
}
