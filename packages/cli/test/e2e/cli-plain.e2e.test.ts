import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { spawnCli } from "./cli-process.ts";
import { freshRuleRoot, playArgs } from "./e2e-shared.ts";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

type LoggedEvent = { kind: string; text?: string };

async function loggedEvents(dir: string): Promise<LoggedEvent[]> {
  const raw = await readFile(join(dir, "timelines/main/events.jsonl"), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LoggedEvent);
}

const inputsOf = (events: LoggedEvent[]): (string | undefined)[] =>
  events.filter((e) => e.kind === "input.received").map((e) => e.text);

test("run --plain player line, colon commands, EOF exit 0", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);

  // The piped lines are echoed to stdout as they are read, so the assertions below look for what only the engine and
  // the REPL print: the `player:` speaker line, the help line, the query result.
  const script = [":help\n", "hello plain e2e\n", ":query player world/vars\n", ":quit\n"].join("");
  const r = await spawnCli({
    args: playArgs(dir, ["run", "--plain", "--scene", "home"]),
    stdin: script,
    timeoutMs: 14_000,
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Plain mode");
  expect(r.stdout).toContain(":save :load :rewind <eventId>");
  expect(r.stdout).toContain("player: hello plain e2e");
  expect(r.stdout).toMatch(/^\{\}$/m);
  expect(r.stderr).not.toMatch(/MODEL_CONFIG|API key/i);

  const events = await loggedEvents(dir);
  expect(inputsOf(events)).toEqual(["hello plain e2e"]);
  expect(events.some((e) => e.kind === "utterance")).toBe(true);
  expect(events.filter((e) => e.kind === "turn.ended")).toHaveLength(1);
});

test("run --plain accepts --viewer for colon :query", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);

  const r = await spawnCli({
    args: playArgs(dir, ["run", "--plain", "--scene", "home", "--viewer", "debug"]),
    stdin: ":query debug world/location\n:quit\n",
    timeoutMs: 14_000,
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain('"home"');
});

test("run --plain EOF without :quit processes the last line and exits cleanly", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);

  const r = await spawnCli({
    args: playArgs(dir, ["run", "--plain", "--scene", "home"]),
    stdin: "one line\n",
    timeoutMs: 14_000,
  });
  expect(r.exitCode).toBe(0);
  expect(inputsOf(await loggedEvents(dir))).toEqual(["one line"]);
});

test("a second run resumes the scene the first one left open", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);

  const first = await spawnCli({
    args: playArgs(dir, ["run", "--plain", "--scene", "home"]),
    stdin: "first session\n:quit\n",
    timeoutMs: 14_000,
  });
  expect(first.exitCode).toBe(0);
  const second = await spawnCli({
    args: playArgs(dir, ["run", "--plain"]),
    stdin: "second session\n:quit\n",
    timeoutMs: 14_000,
  });
  expect(second.exitCode).toBe(0);
  expect(second.stderr).not.toMatch(/already active/i);

  const events = await loggedEvents(dir);
  expect(events.filter((e) => e.kind === "scene.started")).toHaveLength(1);
  expect(inputsOf(events)).toEqual(["first session", "second session"]);
});
