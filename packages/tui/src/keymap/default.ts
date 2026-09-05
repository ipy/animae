import type { Keymap } from "../types.ts";

/** Logical key names (from ink parseKeypress) or literal input for bindings. */
export const defaultKeymap: Required<Keymap> = {
  submit: ["return"],
  choiceUp: ["up"],
  choiceDown: ["down"],
  choicePick: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  skipTypewriter: ["*"],
  focusNext: ["tab"],
  scrollPageUp: ["pageup"],
  scrollPageDown: ["pagedown"],
  help: ["f1"],
  eventLog: ["f2"],
  timeline: ["f3"],
  explain: ["f4"],
  inspector: ["f5"],
  save: ["s"],
  load: ["l"],
  rewindTurn: ["z"],
  closeOverlay: ["escape"],
  quit: ["c"],
};

export function matchKeyAction(
  keymap: Required<Keymap>,
  keyName: string,
  input: string,
  modifiers: { ctrl?: boolean; shift?: boolean },
): keyof Required<Keymap> | undefined {
  const logical = keyName || input;
  for (const [action, keys] of Object.entries(keymap) as Array<
    [keyof Required<Keymap>, string[]]
  >) {
    for (const k of keys) {
      if (k === "*") continue;
      const ctrlChord = modifiers.ctrl && k.length === 1 && k === logical;
      if (ctrlChord) {
        if (
          action === "save" ||
          action === "load" ||
          action === "rewindTurn" ||
          action === "quit"
        ) {
          return action;
        }
        continue;
      }
      if (modifiers.ctrl) continue;
      if (k === logical) return action;
    }
  }
  return undefined;
}

export function choiceIndexFromKey(keyName: string, input: string): number | undefined {
  const ch = (keyName.length === 1 ? keyName : input) || "";
  if (ch.length !== 1) return undefined;
  const n = ch.charCodeAt(0) - 49;
  if (n >= 0 && n <= 8) return n;
  return undefined;
}
