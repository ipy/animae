import { describe, expect, test } from "bun:test";
import { createIntrospect } from "../../src/introspect/service.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import { eventKindAllowed } from "../../src/introspect/visibility.ts";
import { withIntrospectKernel } from "../../src/introspect/custom-viewers.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";

describe("registerViewer", () => {
  test("custom viewer id matches policy rules", () => {
    const { k } = createFakeKernel({
      policy: {
        visibility: {
          rules: [
            { viewer: "auditor", path: "ledger", allow: true },
            { viewer: "player", path: "ledger", allow: false },
          ],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    intro.registerViewer({ id: "auditor" });
    expect(intro.canRead("auditor", "ledger")).toBe(true);
    expect(intro.query("auditor", "ledger")).toBeDefined();
    expect(intro.canRead("player", "ledger")).toBe(false);
  });

  test("extends inherits parent viewer rules", () => {
    const { k } = createFakeKernel({
      policy: {
        visibility: {
          rules: [
            { viewer: "player", path: "world/vars", allow: true },
            { viewer: "player", path: "ledger", allow: false },
            { viewer: "observer", path: "director/*", allow: true },
          ],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    intro.registerViewer({ id: "observer", extends: "player" });
    expect(intro.canRead("observer", "world/vars")).toBe(true);
    expect(intro.canRead("observer", "ledger")).toBe(false);
    expect(intro.canRead("observer", "director/anchors")).toBe(true);
  });

  test("extends cycle stops safely", () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "a", path: "ledger", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    intro.registerViewer({ id: "a", extends: "b" });
    intro.registerViewer({ id: "b", extends: "a" });
    expect(intro.canRead("a", "ledger")).toBe(true);
  });

  test("filter can hide or transform query values", () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "redactor", path: "world/vars", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    intro.registerViewer({
      id: "redactor",
      filter: (path, value) => {
        if (path === "world/vars" && value && typeof value === "object") {
          const copy = { ...(value as Record<string, unknown>) };
          delete copy.secret;
          return copy;
        }
        return value;
      },
    });
    const vars = intro.query("redactor", "world/vars") as Record<string, unknown>;
    expect(vars.public).toBe(2);
    expect(vars.secret).toBeUndefined();
  });

  test("filter returning undefined hides the path", () => {
    const { k } = createFakeKernel({
      policy: { visibility: { rules: [{ viewer: "hide-all", path: "ledger", allow: true }] } },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    intro.registerViewer({ id: "hide-all", filter: () => undefined });
    expect(intro.query("hide-all", "ledger")).toBeUndefined();
  });

  test("eventKindAllowed inherits kinds from extended viewer", () => {
    const { k } = createFakeKernel({
      policy: {
        visibility: {
          rules: [{ viewer: "player", path: "events", allow: true, kinds: ["utterance"] }],
        },
      },
    });
    k.m.memory = createMemoryService(k);
    const intro = createIntrospect(k);
    intro.registerViewer({ id: "wrap", extends: "player" });
    withIntrospectKernel(k, () => {
      expect(eventKindAllowed(k.policy, "wrap", "utterance", [], k.timeline.state().time)).toBe(true);
      expect(eventKindAllowed(k.policy, "wrap", "narration", [], k.timeline.state().time)).toBe(false);
    });
    expect(intro.canRead("debug", "events")).toBe(true);
  });
});
