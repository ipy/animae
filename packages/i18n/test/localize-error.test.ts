import { expect, test } from "bun:test";
import { localizeError } from "../src/localize-error.ts";

test("localizeError uses localizedMessage hook", () => {
  const err = {
    message: "raw",
    localizedMessage: (t: (k: string) => string) => t("key.hook"),
  };
  expect(localizeError(err, (k) => `T:${k}`)).toBe("T:key.hook");
});

test("localizeError uses messageKey with optional namespace", () => {
  const err = { message: "raw", messageKey: "fail", params: { n: 1 } };
  expect(localizeError(err, (k, p) => `${k}/${JSON.stringify(p)}`)).toBe('fail/{"n":1}');
  const namespaced = { message: "raw", messageKey: "fail", messageNamespace: "host" };
  expect(localizeError(namespaced, (k) => k)).toBe("host:fail");
});

test("localizeError falls back to Error message or string", () => {
  expect(localizeError(new Error("boom"), () => "")).toBe("boom");
  expect(localizeError("plain", () => "")).toBe("plain");
});
