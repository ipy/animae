import { measureElement, type DOMElement } from "ink";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { SgrMouseEvent } from "../input/mouse-sgr.ts";
import { hitTestTopmost, metricsToRect, type Rect } from "../utils/hit-test.ts";
import {
  installGlobalMouseCleanup,
  resolveMouseEnabled,
  writeMouseMode,
  type MouseTerminalMode,
} from "../input/mouse-terminal.ts";
import { useStdout } from "ink";

export type MouseTargetHandler = (ev: SgrMouseEvent & { localCol: number; localRow: number }) => void;

export interface MouseTargetRegistration {
  id: string;
  ref: RefObject<DOMElement | null>;
  offsetX?: number;
  offsetY?: number;
  onEvent?: MouseTargetHandler;
  hint?: string;
  disabled?: boolean;
  /** Takes wheel events. A wheel turn goes to the topmost target that does, not to a button on top of it. */
  wheel?: boolean;
}

interface MouseContextValue {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  register: (target: MouseTargetRegistration) => () => void;
  dispatchMouse: (ev: SgrMouseEvent) => void;
  hoverHint: string | undefined;
  liveRegionOffset: { x: number; y: number };
  setLiveRegionRef: (ref: RefObject<DOMElement | null>) => void;
}

const MouseContext = createContext<MouseContextValue | undefined>(undefined);

export function MouseProvider({
  children,
  mouseOption,
  stdin,
  stdout: stdoutProp,
  userEnabled: userEnabledProp,
  onUserEnabledChange,
}: {
  children: ReactNode;
  mouseOption?: boolean | "auto";
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  userEnabled?: boolean;
  onUserEnabledChange?: (on: boolean) => void;
}) {
  const inkStdout = useStdout().stdout;
  const stdout = stdoutProp ?? inkStdout;
  const resolved = resolveMouseEnabled({ mouse: mouseOption, stdout, stdin });
  const [userEnabledInternal, setUserEnabledInternal] = useState(resolved.enabled);
  const userEnabled = userEnabledProp ?? userEnabledInternal;
  const setUserEnabled = onUserEnabledChange ?? setUserEnabledInternal;
  const enabled = resolved.enabled && userEnabled;
  const hoverMode = resolved.hover && enabled;

  const targetsRef = useRef(new Map<string, MouseTargetRegistration>());
  const liveRegionRef = useRef<DOMElement | null>(null);
  const [hoverHint, setHoverHint] = useState<string | undefined>();
  const [liveOffset, setLiveOffset] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!enabled || !("isTTY" in stdout) || !stdout.isTTY) return;
    writeMouseMode(stdout, hoverMode ? "hover" : "basic");
    const uninstall = installGlobalMouseCleanup(stdout);
    return () => {
      uninstall();
      writeMouseMode(stdout, "off");
    };
  }, [enabled, hoverMode, stdout]);

  const register = useCallback((target: MouseTargetRegistration) => {
    targetsRef.current.set(target.id, target);
    return () => targetsRef.current.delete(target.id);
  }, []);

  const setLiveRegionRef = useCallback((ref: RefObject<DOMElement | null>) => {
    liveRegionRef.current = ref.current;
    if (ref.current) {
      const m = measureElement(ref.current);
      setLiveOffset({ x: m.x, y: m.y });
    }
  }, []);

  const buildTargets = useCallback(() => {
    const list: Array<MouseTargetRegistration & { rect: Rect }> = [];
    for (const t of targetsRef.current.values()) {
      if (t.disabled) continue;
      const node = t.ref.current;
      if (!node) continue;
      const m = measureElement(node);
      if (m.width <= 0 && m.height <= 0) continue;
      list.push({ ...t, rect: metricsToRect(m) });
    }
    return list;
  }, []);

  const dispatchMouse = useCallback(
    (ev: SgrMouseEvent) => {
      if (!enabled) return;
      if (ev.shift && (ev.kind === "motion" || ev.kind === "press")) {
        /* Shift+drag: leave selection to the terminal emulator. */
        return;
      }
      const col0 = ev.col - 1;
      const row0 = ev.row - 1;
      const wheel = ev.button === "wheelUp" || ev.button === "wheelDown";
      const targets = buildTargets().filter((t) => !wheel || t.wheel);
      const hit = hitTestTopmost(targets, col0, row0);
      if (ev.kind === "motion" && ev.button === "unknown") {
        setHoverHint(hit?.hint);
        if (hit?.onEvent) {
          hit.onEvent({
            ...ev,
            localCol: col0 - hit.rect.x,
            localRow: row0 - hit.rect.y,
          });
        }
        return;
      }
      if (hit?.onEvent) {
        hit.onEvent({
          ...ev,
          localCol: col0 - hit.rect.x,
          localRow: row0 - hit.rect.y,
        });
      }
      if (ev.kind === "motion") setHoverHint(hit?.hint);
    },
    [buildTargets, enabled],
  );

  const value = useMemo(
    () => ({
      enabled,
      setEnabled: (on: boolean) => setUserEnabled(on),
      register,
      dispatchMouse,
      hoverHint,
      liveRegionOffset: liveOffset,
      setLiveRegionRef,
    }),
    [enabled, register, dispatchMouse, hoverHint, liveOffset, setLiveRegionRef],
  );

  return <MouseContext.Provider value={value}>{children}</MouseContext.Provider>;
}

export function useMouseContext(): MouseContextValue {
  const ctx = useContext(MouseContext);
  if (!ctx) throw new Error("useMouseContext requires MouseProvider");
  return ctx;
}

export function useMouseContextOptional(): MouseContextValue | undefined {
  return useContext(MouseContext);
}

export function useMouseTarget(
  id: string,
  ref: RefObject<DOMElement | null>,
  opts: {
    onEvent?: MouseTargetHandler;
    hint?: string;
    disabled?: boolean;
    wheel?: boolean;
    offsetX?: number;
    offsetY?: number;
    deps?: readonly unknown[];
  },
): { hover: boolean; pressed: boolean } {
  const { register, enabled } = useMouseContext();
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  useLayoutEffect(() => {
    if (!enabled) return;
    return register({
      id,
      ref,
      offsetX: opts.offsetX,
      offsetY: opts.offsetY,
      hint: opts.hint,
      disabled: opts.disabled,
      wheel: opts.wheel,
      onEvent: (ev) => {
        if (ev.kind === "motion") setHover(true);
        if (ev.kind === "press" && ev.button === "left") setPressed(true);
        if (ev.kind === "release") setPressed(false);
        opts.onEvent?.(ev);
      },
    });
  }, [register, id, ref, enabled, opts.disabled, opts.hint, opts.wheel, opts.offsetX, opts.offsetY, ...(opts.deps ?? [])]);

  return { hover: enabled && hover, pressed: enabled && pressed };
}

/** Subscribe to global mouse stream (shell only). */
export function useMouseDispatch(): (ev: SgrMouseEvent) => void {
  return useMouseContext().dispatchMouse;
}
