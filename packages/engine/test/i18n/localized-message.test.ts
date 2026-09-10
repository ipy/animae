import { expect, test } from "bun:test";
import { renderMessage, toLocalizedMessage, message } from "../../src/i18n/index.ts";

test("renderMessage resolves LocalizedMessage and passes plain strings through", () => {
  const t = (key: string, params?: Record<string, unknown>) => `${key}:${JSON.stringify(params ?? {})}`;
  expect(renderMessage({ key: "a.b", params: { n: 1 } }, t)).toBe('a.b:{"n":1}');
  expect(renderMessage("generated narration", t)).toBe("generated narration");
  expect(renderMessage({ key: "x", ns: "host" }, t)).toBe("host:x:{}");
});

test("SystemMessage converts to LocalizedMessage", () => {
  expect(toLocalizedMessage(message("warn.code", { id: "1" }, "diagnostics"))).toEqual({
    key: "warn.code",
    params: { id: "1" },
    ns: "diagnostics",
  });
});
