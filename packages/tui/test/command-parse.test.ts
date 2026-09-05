import { test, expect } from "bun:test";
import { parseColonCommand } from "../src/utils/command-parse.ts";

test("parseColonCommand splits quoted args", () => {
  const p = parseColonCommand(':query player "world/time"');
  expect(p?.name).toBe("query");
  expect(p?.args).toEqual(["player", "world/time"]);
});
