import type { Key } from "ink";

/** Ink `Key` with every flag false — spread overrides for prompt/input tests. */
export const NO_KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
};

export function inkKey(overrides: Partial<Key>): Key {
  return { ...NO_KEY, ...overrides };
}
