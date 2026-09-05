import type { Key } from "ink";

/** Logical key name aligned with ink parseKeypress `name` where possible. */
export function logicalKeyName(name: string, input: string, key: Key): string {
  if (key.return) return "return";
  if (key.escape) return "escape";
  if (key.tab) return "tab";
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.pageUp) return "pageup";
  if (key.pageDown) return "pagedown";
  if (key.backspace) return "backspace";
  if (key.delete) return "delete";
  if (name) return name;
  return input;
}
