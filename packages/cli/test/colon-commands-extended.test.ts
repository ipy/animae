import { mkdtemp, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { openEngine } from "../src/engine-open.ts";
import { runColonCommand } from "../src/plain/colon-commands.ts";
import { runPlainRepl } from "../src/plain/repl.ts";
import { createCliI18n } from "../src/i18n/cli-i18n.ts";

test("colon commands save, load, rewind, branches, explain, advance and query act on the live timeline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-colon-ext-"));
  try {
    await runInit({ dir, preset: "@animae/preset-rule" });
    const engine = await openEngine({ root: dir, mode: "rule" });
    try {
      const sceneId = await engine.scene.start({ location: "home", participants: ["player"] });
      const quiet = { write: () => true } as unknown as NodeJS.WritableStream;
      await runPlainRepl({ engine, sceneId, input: Readable.from(["hello\n", ":quit\n"]), output: quiet, locale: "en" });
      const turnId = ((await engine.timeline.events({ kinds: ["turn.started"] }))[0] as unknown as { turn: string }).turn;

      const lines: string[] = [];
      const api = { engine, viewer: "player" as const, notify: (m: string) => lines.push(m) };
      const say = async (command: string): Promise<string> => {
        lines.length = 0;
        await runColonCommand(command, api);
        return lines.join("\n");
      };
      const clock = () => JSON.stringify(engine.query("debug", "world/time"));

      const saved = /^Saved (\S+) @ (\S+)$/.exec(await say(":save"));
      expect(saved).not.toBeNull();
      const [, label, savedAt] = saved!;
      const timeAtSave = clock();

      expect(await say(":branches")).toContain("main");
      const explained = JSON.parse(await say(`:explain ${turnId}`)) as string[];
      expect(explained.length).toBeGreaterThan(0);
      expect(JSON.parse(await say(":query debug world/time"))).toEqual(JSON.parse(timeAtSave));

      expect(await say(":advance 1h")).toBe("Advanced 1h");
      expect(clock()).not.toBe(timeAtSave);
      expect(await say(`:rewind ${savedAt}`)).toBe(`Rewound to ${savedAt}`);
      expect(clock()).toBe(timeAtSave);
      expect(await say(`:load ${label}`)).toBe(`Loaded ${label}`);

      expect(await say(":mode status")).toContain("[RULE]");
      expect(await say(":nope")).toBe("Unknown command: nope");
    } finally {
      await engine.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("colon commands without their argument print their usage and change nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-colon-usage-"));
  try {
    await runInit({ dir, preset: "@animae/preset-rule" });
    const engine = await openEngine({ root: dir, mode: "rule" });
    try {
      const before = engine.query("debug", "world/time");
      const lines: string[] = [];
      const api = { engine, viewer: "player" as const, notify: (m: string) => lines.push(m) };
      const usage = {
        ":load": "Usage: :load <slot>",
        ":rewind": "Usage: :rewind <eventId>",
        ":explain": "Usage: :explain <turnId>",
        ":query": "Usage: :query <viewer> <path>",
        ":query debug": "Usage: :query <viewer> <path>",
        ":advance": "Usage: :advance <duration>",
      };
      for (const [command, text] of Object.entries(usage)) {
        lines.length = 0;
        await runColonCommand(command, api);
        expect(lines).toEqual([text]);
      }
      expect(engine.query("debug", "world/time")).toEqual(before);
    } finally {
      await engine.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createCliI18n resolves English keys", () => {
  const i18n = createCliI18n("en");
  expect(i18n.t("command.help_line", undefined, { ns: "cli" })).toContain(":");
});
