import type { ReactNode } from "react";
import { MouseProvider } from "../context/mouse-context.tsx";
import { useAppState } from "../context/app-state-context.tsx";

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
      {children}
    </MouseProvider>
  );
}
