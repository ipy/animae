import { useCallback, useEffect, useRef, useState } from "react";
import { useEngineContext } from "../context/engine-context.tsx";
import { queryEngine, shouldUseQueryAsync } from "../utils/engine-query.ts";
import { subscribeQueryChanges } from "../utils/engine-events.ts";

const THROTTLE_MS = 100;

export function useQuery(path: string): unknown {
  const { engine, viewer } = useEngineContext();
  const [value, setValue] = useState(() => engine.query(viewer, path));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(false);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  const applyResult = useCallback(
    (seq: number, next: unknown) => {
      if (!mountedRef.current || seq !== seqRef.current) return;
      setValue(next);
    },
    [],
  );

  const refresh = useCallback(() => {
    const seq = ++seqRef.current;
    if (shouldUseQueryAsync(viewer, engine)) {
      void queryEngine(engine, viewer, path)
        .then((next) => applyResult(seq, next))
        .catch((err: unknown) => {
          if (seq !== seqRef.current || !mountedRef.current) return;
          throw err;
        });
      return;
    }
    applyResult(seq, engine.query(viewer, path));
  }, [applyResult, engine, viewer, path]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      seqRef.current += 1;
    };
  }, []);

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
    const off = subscribeQueryChanges(engine, handler);
    return () => {
      off();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [engine, refresh]);

  return value;
}
