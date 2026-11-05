import { expect, test } from "bun:test";
import { localized, message } from "../../src/i18n/system-message.ts";

test("message and localized shorthands omit empty optional fields", () => {
  expect(message("code.only")).toEqual({ code: "code.only" });
  expect(message("with.params", { n: 1 })).toEqual({ code: "with.params", params: { n: 1 } });
  expect(localized("key.only")).toEqual({ key: "key.only" });
  expect(localized("k", { x: 1 }, "ns")).toEqual({ key: "k", params: { x: 1 }, ns: "ns" });
});
