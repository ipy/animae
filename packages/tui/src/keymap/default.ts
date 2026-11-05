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
  commandPalette: ["p"],
  toggleMouse: ["m"],
  help: ["f1"],
  eventLog: ["f2"],
  timeline: ["f3"],
  explain: ["f4"],
  inspector: ["f5"],
  mode: ["f6"],
  save: ["s"],
  load: ["l"],
  rewindTurn: ["z"],
  closeOverlay: ["escape"],
  quit: ["c"],
};

const META_OVERLAY_DIGITS: Partial<Record<keyof Required<Keymap>, string>> = {
  help: "1",
  eventLog: "2",
  timeline: "3",
  explain: "4",
  inspector: "5",
  mode: "6",
};

/** Single-letter bindings that require Ctrl (or Meta overlay digits), never plain typing. */
const CTRL_LETTER_ACTIONS = new Set<keyof Required<Keymap>>([
  "save",
  "load",
  "rewindTurn",
  "quit",
  "commandPalette",
  "toggleMouse",
]);

export function matchKeyAction(
  keymap: Required<Keymap>,
  keyName: string,
  input: string,
  modifiers: { ctrl?: boolean; shift?: boolean; meta?: boolean },
): keyof Required<Keymap> | undefined {
  const logical = keyName || input;
  if (modifiers.meta && !modifiers.ctrl) {
    for (const [action, digit] of Object.entries(META_OVERLAY_DIGITS) as Array<
      [keyof Required<Keymap>, string]
    >) {
      if (logical === digit || input === digit) return action;
    }
  }
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
          action === "quit" ||
          action === "commandPalette" ||
          action === "toggleMouse"
        ) {
          return action;
        }
        continue;
      }
      if (modifiers.ctrl) continue;
      if (k === logical) {
        if (k.length === 1 && CTRL_LETTER_ACTIONS.has(action)) continue;
        return action;
      }
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
