import { Text } from "ink";
import type { CueRenderer } from "../types.ts";
import { cueVisibleAt } from "./registry.ts";

export const builtinCueRenderers: Record<string, CueRenderer> = {
  expression: (cue, ctx) => {
    const at = cue.at ?? 0;
    if (!cueVisibleAt(at, ctx.visibleChars)) return null;
    const name = String(cue.args["name"] ?? cue.args["id"] ?? "");
    if (!name) return null;
    return <Text dimColor>[{name}]</Text>;
  },
  action: (cue, ctx) => {
    const at = cue.at ?? Number(cue.args["at"] ?? 0);
    if (!cueVisibleAt(at, ctx.visibleChars)) return null;
    const text = String(cue.args["text"] ?? "");
    return (
      <Text italic dimColor>
        （{text}）
      </Text>
    );
  },
  sfx: (cue, ctx) => {
    const at = cue.at ?? Number(cue.args["at"] ?? 0);
    if (!cueVisibleAt(at, ctx.visibleChars)) return null;
    const name = String(cue.args["name"] ?? "");
    return (
      <Text dimColor>
        ♪ {name}
      </Text>
    );
  },
};

/** Resolve expression label for speaker line (at offset 0). */
export function expressionLabel(
  cues: Array<{ type: string; args: Record<string, unknown>; at: number }>,
  visibleChars: number,
): string | undefined {
  for (const c of cues) {
    if (c.type !== "expression") continue;
    if (!cueVisibleAt(c.at, visibleChars)) continue;
    const name = String(c.args["name"] ?? c.args["id"] ?? "");
    if (name) return name;
  }
  return undefined;
}
