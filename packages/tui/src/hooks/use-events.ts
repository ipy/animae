import { useEffect, useState } from "react";
import type { EngineEvent } from "@animae/engine";
import { useEngine } from "./use-engine.ts";

export function useEvents(kinds?: string[]): EngineEvent[] {
  const engine = useEngine();
  const [events, setEvents] = useState<EngineEvent[]>([]);

  useEffect(() => {
    let mounted = true;
    void engine.timeline.events({ limit: 200 }).then((list) => {
      if (mounted) setEvents(filterKinds(list, kinds));
    });
    const handler = (e: EngineEvent) => {
      if (kinds && kinds.length > 0 && !kinds.includes(e.kind)) return;
      setEvents((prev) => [...prev.slice(-199), e]);
    };
    const watchKinds =
      kinds && kinds.length > 0
        ? kinds
        : ["input.received", "route.decided", "utterance", "scene.started", "scene.ended"];
    const offs = watchKinds.map((k) => engine.on(k, handler));
    const off = () => offs.forEach((f) => f());
    return () => {
      mounted = false;
      off();
    };
  }, [engine, kinds?.join(",")]);

  return events;
}

function filterKinds(events: EngineEvent[], kinds?: string[]): EngineEvent[] {
  if (!kinds || kinds.length === 0) return events;
  return events.filter((e) => kinds.includes(e.kind));
}
