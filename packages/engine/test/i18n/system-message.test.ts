import { expect, test } from "bun:test";
import { formatSystemMessage, message, systemMessageKey } from "../../src/i18n/system-message.ts";

test("systemMessageKey and formatSystemMessage", () => {
  const msg = message("config.warning", { code: "mod_engine" }, "diagnostics");
  expect(systemMessageKey(msg)).toBe("diagnostics:config.warning");
  const text = formatSystemMessage(msg, (key, params) => `${key}:${(params as { code: string }).code}`);
  expect(text).toBe("diagnostics:config.warning:mod_engine");
});
