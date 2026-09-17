import { describe, expect, test } from "bun:test";
import { NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { repairJsonText, salvageStructuredFromValidationError } from "../../src/model/salvage-output.ts";
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

function noObject(text: string): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: "no object",
    text,
    response: {} as never,
    finishReason: "length",
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    },
  });
}

describe("repairJsonText", () => {
  const parse = (raw: string) => JSON.parse(repairJsonText(raw)?.json ?? "null") as unknown;

  test("escapes raw control characters inside strings", () => {
    expect(parse('{"text":"line one\nline two\tend"}')).toEqual({ text: "line one\nline two\tend" });
    expect(parse('{"text":"a\u0001b"}')).toEqual({ text: "a\u0001b" });
  });

  test("closes a string that was cut off, and the containers around it", () => {
    expect(parse('{"text":"half a sent')).toEqual({ text: "half a sent" });
    expect(parse('{"text":"ok","cues":[{"type":"expression","args":{"name":"sm')).toEqual({
      text: "ok",
      cues: [{ type: "expression", args: { name: "sm" } }],
    });
  });

  test("drops a dangling key, a key without a value and a trailing comma", () => {
    expect(parse('{"text":"ok","cu')).toEqual({ text: "ok" });
    expect(parse('{"text":"ok","cues":')).toEqual({ text: "ok" });
    expect(parse('{"text":"ok",')).toEqual({ text: "ok" });
    expect(parse('{"text":"ok","tags":["a","b')).toEqual({ text: "ok", tags: ["a", "b"] });
  });

  test("keeps a complete object and ignores trailing noise; no object means nothing to repair", () => {
    expect(parse('{"a":1} trailing words')).toEqual({ a: 1 });
    expect(repairJsonText('{"a":1} trailing words')?.truncated).toBe(false);
    expect(repairJsonText('{"a":"cut')?.truncated).toBe(true);
    expect(repairJsonText("just prose")).toBeUndefined();
  });
});

describe("salvageStructuredFromValidationError (cut-off JSON)", () => {
  const schema = buildRenderSchema(minimalPolicy());

  test("keeps the text of a reply that was cut off inside a later field", () => {
    const err = noObject('{"text":"（她停了一下）今天温室很稳。","cues":[{"type":"expression","args":{"na');
    const out = salvageStructuredFromValidationError(err, schema);
    expect(out?.text).toBe("（她停了一下）今天温室很稳。");
    expect(out?.cues).toEqual([]);
  });

  test("keeps a reply whose text was cut off mid-sentence", () => {
    const out = salvageStructuredFromValidationError(noObject('{"text":"The generator is holding, but only if'), schema);
    expect(out?.text).toBe("The generator is holding, but only if");
  });

  test("accepts a full reply that only failed on a raw newline in the text", () => {
    const out = salvageStructuredFromValidationError(
      noObject('{"text":"First line.\nSecond line.","cues":[],"intent_realized":"talk"}'),
      schema,
    );
    expect(out?.text).toBe("First line.\nSecond line.");
    expect(out?.intent_realized).toBe("talk");
  });

  test("gives up when there is no text to keep", () => {
    expect(salvageStructuredFromValidationError(noObject('{"cues":[{"type":"expr'), schema)).toBeUndefined();
    expect(salvageStructuredFromValidationError(noObject('{"text":"  "'), schema)).toBeUndefined();
  });

  test("a complete reply with a malformed sibling field still delivers its text", () => {
    const out = salvageStructuredFromValidationError(noObject('{"text":"Still here.","cues":"none","intent_realized":7}'), schema);
    expect(out?.text).toBe("Still here.");
    expect(out?.cues).toEqual([]);
  });
});
