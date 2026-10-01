// @ts-nocheck
import { expect, test } from "bun:test";
import { copyText } from "../ref-client/js/copy.js";

test("copyText returns false for empty input", async () => {
  expect(await copyText("")).toBe(false);
});
