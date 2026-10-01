import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import { rethrowPipelineModelError } from "../../src/pipeline/model-error.ts";
import { AnimaeError } from "../../src/types.ts";

describe("rethrowPipelineModelError", () => {
  test("preserves MODEL_HTTP through pipeline wrapper", () => {
    const api = new APICallError({
      message: "rate",
      url: "https://api.test/v1",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {},
      responseBody: "slow down",
      isRetryable: true,
    });
    expect(() => rethrowPipelineModelError(api, "RENDER_FAILED", "render failed")).toThrow(
      expect.objectContaining({ code: "MODEL_HTTP", params: expect.objectContaining({ status: 429 }) }),
    );
  });

  test("falls back to RENDER_FAILED for unknown errors", () => {
    expect(() => rethrowPipelineModelError(new Error("weird"), "RENDER_FAILED", "render failed")).toThrow(
      expect.objectContaining({ code: "RENDER_FAILED" }),
    );
  });

  test("rethrows classified AnimaeError unchanged", () => {
    const e = new AnimaeError("MODEL_EMPTY", "empty");
    expect(() => rethrowPipelineModelError(e, "RENDER_FAILED", "x")).toThrow(e);
  });
});
