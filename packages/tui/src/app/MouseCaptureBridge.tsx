import type { ReactNode } from "react";
import { useEffect } from "react";
import { MouseProvider, useMouseDispatch } from "../context/mouse-context.tsx";
import { useAppState } from "../context/app-state-context.tsx";
import { preparsedMouseBus } from "../input/preparsed-mouse-bus.ts";
import type { SgrMouseEvent } from "../input/mouse-sgr.ts";

function PreparsedMouseBridge({ children }: { children: ReactNode }) {
  const dispatchMouse = useMouseDispatch();
  useEffect(() => {
    const onSgr = (ev: SgrMouseEvent) => dispatchMouse(ev);
    preparsedMouseBus.on("sgr", onSgr);
    return () => {
      preparsedMouseBus.off("sgr", onSgr);
    };
  }, [dispatchMouse]);
  return children;
}

export function MouseCaptureBridge({
  children,
  mouseOption,
  stdin,
  stdout,
}: {
  children: ReactNode;
  mouseOption?: boolean | "auto";
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}) {
  const { state, dispatch } = useAppState();
  return (
    <MouseProvider
      mouseOption={mouseOption}
      stdin={stdin}
      stdout={stdout}
      userEnabled={state.mouseCapture}
      onUserEnabledChange={(on) => dispatch({ type: "setMouseCapture", on })}
    >
      <PreparsedMouseBridge>{children}</PreparsedMouseBridge>
    </MouseProvider>
  );
}
