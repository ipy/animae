import { describe, expect, test } from "bun:test";
import { APICallError, JSONParseError } from "ai";
import { classifyModelError } from "../../src/model/classify-error.ts";
import { AnimaeError } from "../../src/types.ts";

describe("classifyModelError", () => {
  test("MODEL_HTTP from APICallError", () => {
    const err = new APICallError({
      message: "Unauthorized",
      url: "https://api.example.com/v1/chat",
      requestBodyValues: {},
      statusCode: 401,
      responseHeaders: {},
      responseBody: "invalid key",
      isRetryable: false,
    });
    const out = classifyModelError(err);
    expect(out?.code).toBe("MODEL_HTTP");
    expect(out?.params?.status).toBe(401);
    expect(String(out?.params?.detail)).toContain("invalid");
  });

  test("MODEL_UNREACHABLE from ECONNREFUSED cause chain", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const wrapped = new Error("fetch failed", { cause: inner });
    const out = classifyModelError(wrapped, { baseURL: "http://127.0.0.1:11434" });
    expect(out?.code).toBe("MODEL_UNREACHABLE");
    expect(out?.params?.host).toBe("127.0.0.1:11434");
  });

  test("MODEL_UNREACHABLE from Bun fetch connection errors", () => {
    for (const [code, message] of [
      ["ConnectionRefused", "Unable to connect. Is the computer able to access the url?"],
      ["FailedToOpenSocket", "Was there a typo in the url or port?"],
      ["ConnectionClosed", "The socket connection was closed unexpectedly."],
    ] as const) {
      const inner = Object.assign(new Error(message), { code });
      const api = new APICallError({
        message: `Cannot connect to API: ${message}`,
        url: "http://127.0.0.1:11434/api/chat",
        requestBodyValues: {},
        cause: inner,
        isRetryable: true,
      });
      const out = classifyModelError(api, { baseURL: "http://127.0.0.1:11434/api" });
      expect(out?.code).toBe("MODEL_UNREACHABLE");
      expect(out?.params?.host).toBe("127.0.0.1:11434");
    }
  });

  test("MODEL_TIMEOUT from AbortError", () => {
    const err = new DOMException("Timed out", "TimeoutError");
    const out = classifyModelError(err, { timeoutMs: 120_000 });
    expect(out?.code).toBe("MODEL_TIMEOUT");
    expect(out?.params?.seconds).toBe(120);
    expect(out?.params?.phase).toBeDefined();
  });

  test("output that merely mentions a timeout is not classified as a timeout", () => {
    const err = new JSONParseError({ text: '{"note": "the request timed out, aborted"}', cause: new Error("Unexpected token") });
    expect(classifyModelError(err, { timeoutMs: 120_000 })).toBeUndefined();
  });

  test("preserves existing classified AnimaeError", () => {
    const original = new AnimaeError("MODEL_EMPTY", "empty", undefined, { params: {} });
    expect(classifyModelError(original)?.code).toBe("MODEL_EMPTY");
  });

  test("nested cause APICallError inside AnimaeError", () => {
    const api = new APICallError({
      message: "Not found",
      url: "https://gw.test/v1",
      requestBodyValues: {},
      statusCode: 404,
      responseHeaders: {},
      responseBody: "model missing",
      isRetryable: false,
    });
    const wrap = new AnimaeError("RENDER_FAILED", "fail", api);
    expect(classifyModelError(wrap)?.code).toBe("MODEL_HTTP");
  });
});
