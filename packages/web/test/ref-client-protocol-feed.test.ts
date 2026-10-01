// @ts-nocheck
import { expect, test } from "bun:test";
import { pushProtocolFrame, filterProtocolFeed } from "../ref-client/js/protocol-feed.js";

test("protocol feed caps buffer", () => {
  const buf: Record<string, unknown>[] = [];
  for (let i = 0; i < 600; i++) {
    pushProtocolFrame(buf, { v: 1, type: "ping", seq: i, id: "x" }, "out", 500);
  }
  expect(buf.length).toBe(500);
});

test("filterProtocolFeed by type", () => {
  const buf = [
    { type: "ping", direction: "out", body: {} },
    { type: "pong", direction: "in", body: {} },
  ];
  expect(filterProtocolFeed(buf, "ping")).toHaveLength(1);
});
