import { test, expect } from "bun:test";
import type { CommandApi } from "@animae/tui";
import type { HostCommandApi } from "../src/types.ts";

type HostImplementsTuiCommandApi = CommandApi extends HostCommandApi ? true : false;
const _parity: HostImplementsTuiCommandApi = true;

test("HostCommandApi covers TUI CommandApi surface", () => {
  expect(_parity).toBe(true);
});
