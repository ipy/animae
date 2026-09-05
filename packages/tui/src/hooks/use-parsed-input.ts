import { useEffect, useEffectEvent, useRef } from "react";
import { useStdin, type Key } from "ink";
import { logicalKeyName } from "../keymap/ink-key.ts";
import { parseKeypress } from "../ink/parse-keypress.ts";
import { createInputParser, isCompleteControlSequence } from "../ink/vendor/input-parser.js";

type StdinInternal = ReturnType<typeof useStdin> & {
  internal_eventEmitter: {
    on: (ev: string, h: (data: string) => void) => void;
    removeListener: (ev: string, h: (data: string) => void) => void;
  };
  internal_exitOnCtrlC: boolean;
};

export type ParsedInput = {
  name: string;
  input: string;
  key: Key;
  ctrl: boolean;
  shift: boolean;
};

type Handler = (ev: ParsedInput) => void;

function emitParsedKeypress(data: string, handler: Handler, internal_exitOnCtrlC: boolean) {
  const keypress = parseKeypress(data);
  const key: Key = {
    upArrow: keypress.name === "up",
    downArrow: keypress.name === "down",
    leftArrow: keypress.name === "left",
    rightArrow: keypress.name === "right",
    pageDown: keypress.name === "pagedown",
    pageUp: keypress.name === "pageup",
    home: keypress.name === "home",
    end: keypress.name === "end",
    return: keypress.name === "return" || keypress.name === "enter",
    escape: keypress.name === "escape",
    ctrl: keypress.ctrl,
    shift: keypress.shift,
    tab: keypress.name === "tab",
    backspace: keypress.name === "backspace",
    delete: keypress.name === "delete",
    meta: keypress.meta,
    super: keypress.super ?? false,
    hyper: keypress.hyper ?? false,
    capsLock: keypress.capsLock ?? false,
    numLock: keypress.numLock ?? false,
    eventType: keypress.eventType,
  };

  if (
    internal_exitOnCtrlC &&
    keypress.name === "c" &&
    keypress.ctrl &&
    keypress.eventType !== "release"
  ) {
    return;
  }

  let input: string;
  if (keypress.isKittyProtocol) {
    input = keypress.isPrintable ? (keypress.text ?? keypress.name) : "";
  } else if (keypress.ctrl) {
    input = keypress.name === "space" ? " " : (keypress.name ?? "");
  } else {
    input = keypress.sequence;
  }
  if (!keypress.isKittyProtocol && input.length === 1 && /[A-Z]/.test(input)) {
    key.shift = true;
  }

  const name = logicalKeyName(keypress.name, input, key);
  handler({ name, input, key, ctrl: keypress.ctrl, shift: keypress.shift });
}

/** Stdin listener that exposes parseKeypress `name` (incl. F-keys). */
export function useParsedInput(handler: Handler, options?: { isActive?: boolean }) {
  const stdinCtx = useStdin() as StdinInternal;
  const { isRawModeSupported, setRawMode, internal_eventEmitter, internal_exitOnCtrlC } =
    stdinCtx;
  const active = options?.isActive !== false;
  const inputParserRef = useRef(createInputParser());

  useEffect(() => {
    if (!active || !isRawModeSupported) return;
    setRawMode(true);
    return () => {
      setRawMode(false);
      inputParserRef.current.reset();
    };
  }, [active, isRawModeSupported, setRawMode]);

  const handleKeypress = useEffectEvent((data: string) => {
    emitParsedKeypress(data, handler, internal_exitOnCtrlC);
  });

  const onData = useEffectEvent((data: string) => {
    for (const event of inputParserRef.current.push(data)) {
      if (typeof event !== "string") continue;
      if (event.length <= 1 || isCompleteControlSequence(event)) {
        handleKeypress(event);
        continue;
      }
      for (const ch of event) {
        handleKeypress(ch);
      }
    }
  });

  useEffect(() => {
    if (!active) return;
    internal_eventEmitter.on("input", onData);
    return () => internal_eventEmitter.removeListener("input", onData);
  }, [active, internal_eventEmitter, onData]);
}
