import { test, expect } from "bun:test";
import { Text, renderToString } from "ink";

test("renderToString snapshot", () => {
  const out = renderToString(<Text>Hello TUI</Text>);
  expect(out).toContain("Hello TUI");
});
