import { describe, expect, test } from "bun:test";
import { NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { salvageStructuredFromValidationError } from "../../src/model/salvage-output.ts";
import { buildRenderSchema } from "../../src/pipeline/schemas.ts";
import { minimalPolicy } from "../timeline/fixture.ts";

describe("salvageStructuredFromValidationError", () => {
  test("wraps prose-only render body", () => {
    const schema = buildRenderSchema(minimalPolicy());
    const prose = "（她停了一下）今天温室很稳。";
    const err = new NoObjectGeneratedError({
      message: "no object",
      text: prose,
      response: {} as never,
      finishReason: "stop",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
    });
    const out = salvageStructuredFromValidationError(err, schema);
    expect(out?.text).toBe(prose);
    expect(out?.cues).toEqual([]);
  });

  test("parses fenced JSON", () => {
    const schema = z.object({ ok: z.literal(true) });
    const err = new NoObjectGeneratedError({
      message: "no object",
      text: '```json\n{"ok":true}\n```',
      response: {} as never,
      finishReason: "stop",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
    });
    expect(salvageStructuredFromValidationError(err, schema)?.ok).toBe(true);
  });
});
