import { expect, test } from "bun:test";
import { formatStructuredMessage, structuredMessage } from "../src/structured-message.ts";

test("structuredMessage shapes", () => {
  expect(structuredMessage("code")).toEqual({ code: "code" });
  expect(structuredMessage("code", { n: 1 })).toEqual({ code: "code", params: { n: 1 } });
  expect(structuredMessage("code", { n: 1 }, "host")).toEqual({ code: "code", params: { n: 1 }, namespace: "host" });
});

test("formatStructuredMessage resolves namespace", () => {
  const msg = structuredMessage("fail", { id: "x" }, "web");
  expect(formatStructuredMessage(msg, (k, p) => `${k}:${p?.id}`)).toBe("web:fail:x");
});
