import { describe, expect, test } from "bun:test";
import { Text, render } from "ink";
import { useEffect, useRef } from "react";
import { EngineProvider } from "../src/context/engine-context.tsx";
import { useQuery } from "../src/hooks/use-query.ts";
import { queryEngine, shouldUseQueryAsync } from "../src/utils/engine-query.ts";
import { createTuiFakeEngineControls } from "./helpers/fake-engine.ts";
import { waitMs } from "./helpers/ink-harness.ts";

function QueryProbe({ path, onValue }: { path: string; onValue: (v: unknown) => void }) {
  const v = useQuery(path);
  const last = useRef<unknown>(undefined);
  useEffect(() => {
    if (last.current !== v) {
      last.current = v;
      onValue(v);
    }
  }, [v, onValue]);
  return <Text>{JSON.stringify(v)}</Text>;
}

describe("engine-query helper", () => {
  test("shouldUseQueryAsync only for player when queryAsync exists", () => {
    const engine = createTuiFakeEngineControls().engine;
    expect(shouldUseQueryAsync("player", engine)).toBe(true);
    expect(shouldUseQueryAsync("debug", engine)).toBe(false);
  });

  test("queryEngine uses queryAsync for player", async () => {
    let asyncCalls = 0;
    const engine = createTuiFakeEngineControls({
      query: () => ({ sync: true }),
      queryAsync: async () => {
        asyncCalls++;
        return { async: true };
      },
    }).engine;
    expect(await queryEngine(engine, "player", "world/time")).toEqual({ async: true });
    expect(asyncCalls).toBe(1);
    expect(await queryEngine(engine, "debug", "world/time")).toEqual({ sync: true });
  });
});

describe("useQuery", () => {
  test("returns initial sync projection then async refresh for player", async () => {
    const controls = createTuiFakeEngineControls({
      query: () => ({ pass: "sync" }),
      queryAsync: async () => ({ pass: "async" }),
    });
    const seen: unknown[] = [];
    const instance = render(
      <EngineProvider value={{ engine: controls.engine, viewer: "player", actor: "player" }}>
        <QueryProbe path="world/time" onValue={(v) => seen.push(v)} />
      </EngineProvider>,
      { patchConsole: false },
    );
    await waitMs(20);
    instance.unmount();
    expect(seen[0]).toEqual({ pass: "sync" });
    expect(seen.some((v) => (v as { pass?: string }).pass === "async")).toBe(true);
  });

  test("ignores stale async results after rerender with new path", async () => {
    const seen: unknown[] = [];
    let gen = 0;
    const engine = createTuiFakeEngineControls({
      query: (_v, path) => ({ path, sync: true }),
      queryAsync: async (_v, path) => {
        const my = ++gen;
        if (path === "world/time") await waitMs(50);
        return { path, gen: my };
      },
    }).engine;

    const inst = render(
      <EngineProvider value={{ engine, viewer: "player", actor: "player" }}>
        <QueryProbe path="world/time" onValue={(v) => seen.push(v)} />
      </EngineProvider>,
      { patchConsole: false },
    );
    inst.rerender(
      <EngineProvider value={{ engine, viewer: "player", actor: "player" }}>
        <QueryProbe path="world/location" onValue={(v) => seen.push(v)} />
      </EngineProvider>,
    );
    await waitMs(80);
    inst.unmount();
    const gens = seen.map((v) => (v as { gen?: number }).gen).filter((g) => g !== undefined);
    expect(gens).not.toContain(1);
    expect(gens.some((g) => g === 2)).toBe(true);
  });

  test("engine events schedule throttled refresh", async () => {
    let asyncCalls = 0;
    const controls = createTuiFakeEngineControls({
      queryAsync: async () => {
        asyncCalls++;
        return { n: asyncCalls };
      },
    });
    const seen: unknown[] = [];
    const inst = render(
      <EngineProvider value={{ engine: controls.engine, viewer: "player", actor: "player" }}>
        <QueryProbe path="world/time" onValue={(v) => seen.push(v)} />
      </EngineProvider>,
      { patchConsole: false },
    );
    controls.emit("world.var_set");
    await waitMs(120);
    inst.unmount();
    expect(asyncCalls).toBeGreaterThan(1);
  });

  test("debug viewer stays on sync query only", async () => {
    let asyncCalls = 0;
    const engine = createTuiFakeEngineControls({
      query: () => ({ mode: "sync" }),
      queryAsync: async () => {
        asyncCalls++;
        return { mode: "async" };
      },
    }).engine;
    const seen: unknown[] = [];
    const inst = render(
      <EngineProvider value={{ engine, viewer: "debug", actor: "player" }}>
        <QueryProbe path="world/time" onValue={(v) => seen.push(v)} />
      </EngineProvider>,
      { patchConsole: false },
    );
    await waitMs(20);
    inst.unmount();
    expect(asyncCalls).toBe(0);
    expect(seen.every((v) => (v as { mode?: string }).mode === "sync")).toBe(true);
  });

});
