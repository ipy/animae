import { useCallback, useEffect, useRef, useState } from "react";
import { useEngineContext } from "../context/engine-context.tsx";
import { subscribeEngineEvents } from "../utils/engine-events.ts";

const THROTTLE_MS = 100;

export function useQuery(path: string): unknown {
  const { engine, viewer } = useEngineContext();
  const [value, setValue] = useState(() => engine.query(viewer, path));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(false);

  const refresh = useCallback(() => {
    setValue(engine.query(viewer, path));
  }, [engine, viewer, path]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const schedule = () => {
      pending.current = true;
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = undefined;
        if (pending.current) {
          pending.current = false;
          refresh();
        }
      }, THROTTLE_MS);
    };
    const handler = () => schedule();
    const off = subscribeEngineEvents(engine, handler);
    return () => {
      off();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [engine, refresh]);

  return value;
}
