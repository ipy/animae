import { expect, test } from "bun:test";
import { z } from "zod";
import { recordingKey } from "../../src/model/recording-key.ts";

test("recording key includes recordingLocales", () => {
  const schema = z.object({ text: z.string() });
  const segments = { static: "a", semiStatic: "b", dynamic: "c", user: "u" };
  const base = recordingKey("m1", { label: "render", segments, schema, maxOutputTokens: 100 });
  const withLocales = recordingKey("m1", {
    label: "render",
    segments,
    schema,
    maxOutputTokens: 100,
    recordingLocales: { promptLocale: "fr", outputLocale: "en", contentLocale: "fr" },
  });
  expect(base).not.toBe(withLocales);
});
