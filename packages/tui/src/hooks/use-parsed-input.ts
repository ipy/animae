import { useEffect, useEffectEvent, useRef } from "react";
import { useStdin, type Key } from "ink";
import { logicalKeyName } from "../keymap/ink-key.ts";
import { parseKeypress } from "../ink/parse-keypress.ts";
import { createInputParser, isCompleteControlSequence } from "../ink/vendor/input-parser.js";
import { parseSgrMouseChunk, type SgrMouseEvent } from "../input/mouse-sgr.ts";

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
type PasteHandler = (text: string) => void;

type StdinContext = StdinInternal & {
  setBracketedPasteMode?: (enabled: boolean) => void;
};

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
export function useParsedInput(
  handler: Handler,
  options?: {
    isActive?: boolean;
    onMouse?: (ev: SgrMouseEvent) => void;
    onPaste?: PasteHandler;
  },
) {
  const stdinCtx = useStdin() as StdinContext;
  const {
    isRawModeSupported,
    setRawMode,
    setBracketedPasteMode,
    internal_eventEmitter,
    internal_exitOnCtrlC,
  } = stdinCtx;
  const active = options?.isActive !== false;
  const inputParserRef = useRef(createInputParser());
  const mousePendingRef = useRef("");
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const onMouseRef = useRef(options?.onMouse);
  onMouseRef.current = options?.onMouse;
  const pendingFlushRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Match Ink App pending flush; slightly longer for loaded main thread. */
  const PENDING_ESC_MS = 50;
  const onPasteRef = useRef(options?.onPaste);
  onPasteRef.current = options?.onPaste;

  const clearPendingFlush = () => {
    if (pendingFlushRef.current !== undefined) {
      clearTimeout(pendingFlushRef.current);
      pendingFlushRef.current = undefined;
    }
  };

  const schedulePendingEscapeFlush = () => {
    clearPendingFlush();
    pendingFlushRef.current = setTimeout(() => {
      pendingFlushRef.current = undefined;
      const pendingEscape = inputParserRef.current.flushPendingEscape();
      if (pendingEscape) handleKeypress(pendingEscape);
    }, PENDING_ESC_MS);
  };

  useEffect(() => {
    if (!active || !isRawModeSupported) return;
    setRawMode(true);
    setBracketedPasteMode?.(Boolean(onPasteRef.current));
    return () => {
      clearPendingFlush();
      setRawMode(false);
      setBracketedPasteMode?.(false);
      inputParserRef.current.reset();
      mousePendingRef.current = "";
    };
  }, [active, isRawModeSupported, setRawMode, setBracketedPasteMode]);

  const handleKeypress = useEffectEvent((data: string) => {
    emitParsedKeypress(data, handlerRef.current, internal_exitOnCtrlC);
  });

  const onData = useEffectEvent((data: string) => {
    clearPendingFlush();
    let keyboardChunk = data;
    const onMouse = onMouseRef.current;
    if (onMouse) {
      const parsed = parseSgrMouseChunk(mousePendingRef.current, data);
      mousePendingRef.current = parsed.pending;
      for (const ev of parsed.events) onMouse(ev);
      keyboardChunk = parsed.rest;
      if (!keyboardChunk) {
        if (inputParserRef.current.hasPendingEscape()) schedulePendingEscapeFlush();
        return;
      }
    }
    for (const event of inputParserRef.current.push(keyboardChunk)) {
      if (typeof event !== "string") continue;
      if (event.length <= 1 || isCompleteControlSequence(event)) {
        handleKeypress(event);
        continue;
      }
      for (const ch of event) {
        handleKeypress(ch);
      }
    }
    if (inputParserRef.current.hasPendingEscape()) schedulePendingEscapeFlush();
  });

  const onPaste = useEffectEvent((text: string) => {
    onPasteRef.current?.(text);
  });

  useEffect(() => {
    if (!active) return;
    internal_eventEmitter.on("input", onData);
    return () => internal_eventEmitter.removeListener("input", onData);
  }, [active, internal_eventEmitter, onData]);

  useEffect(() => {
    if (!active || !onPasteRef.current) return;
    internal_eventEmitter.on("paste", onPaste);
    return () => internal_eventEmitter.removeListener("paste", onPaste);
  }, [active, internal_eventEmitter, onPaste]);
}
