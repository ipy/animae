import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString, Text } from "ink";
import { EngineProvider } from "../src/context/engine-context.tsx";
import { useSpeakerLabel } from "../src/hooks/use-speaker-label.ts";
import { characterDisplayName } from "../src/utils/character-name.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import type { Engine } from "../src/types.ts";

/** An engine like the real one for the player viewer: character identities are redacted. */
function redactedEngine(): Engine {
  const base = createTuiFakeEngine();
  return {
    ...base,
    query: (viewer, path) => {
      if (path === "characters") return [{ id: "mira" }];
      if (path.endsWith("/identity")) return viewer === "debug" ? { name: "Mira Vale" } : undefined;
      return base.query(viewer, path);
    },
  };
}

function Label({ speaker }: { speaker: string }) {
  return createElement(Text, null, `[${useSpeakerLabel(speaker)}]`);
}

function renderLabel(engine: Engine, displayName?: (id: string) => string | undefined): string {
  return renderToString(
    createElement(EngineProvider, {
      value: { engine, viewer: "player", actor: "player", displayName },
      children: createElement(Label, { speaker: "mira" }),
    }),
  );
}

describe("speaker label", () => {
  test("uses the host display name when the viewer cannot read identities", () => {
    expect(renderLabel(redactedEngine(), (id) => (id === "mira" ? "Mira Vale" : undefined))).toContain("[Mira Vale]");
  });

  test("falls back to the identity query, then to the raw id", () => {
    const engine = createTuiFakeEngine({
      query: (_viewer, path) => (path === "characters/mira/identity" ? { name: "Mira" } : path === "characters" ? [] : undefined),
    });
    expect(renderLabel(engine)).toContain("[Mira]");
    expect(renderLabel(redactedEngine())).toContain("[mira]");
  });

  test("ignores blank host names", () => {
    expect(renderLabel(redactedEngine(), () => "  ")).toContain("[mira]");
  });
});

describe("characterDisplayName", () => {
  test("prefers the host resolver over the identity query", () => {
    const engine = createTuiFakeEngine({ query: () => ({ name: "From Card" }) });
    expect(characterDisplayName({ engine, viewer: "player", displayName: () => "From Host" }, "x")).toBe("From Host");
    expect(characterDisplayName({ engine, viewer: "player" }, "x")).toBe("From Card");
  });

  test("is undefined when nothing knows the character", () => {
    expect(characterDisplayName({ engine: redactedEngine(), viewer: "player" }, "mira")).toBeUndefined();
  });
});
