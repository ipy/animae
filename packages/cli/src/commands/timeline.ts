import { printError } from "../errors.ts";
import { openEngine, type OpenEngineOptions } from "../engine-open.ts";

export async function runTimeline(sub: string, rest: string[], opts: OpenEngineOptions): Promise<number> {
  let engine;
  try {
    engine = await openEngine(opts);
  } catch (err) {
    printError(err);
    return 1;
  }

  try {
    switch (sub) {
      case "list": {
        const branches = await engine.timeline.branches();
        const saves = await engine.timeline.saves();
        process.stdout.write(`branch: ${engine.timeline.current().name}\n`);
        process.stdout.write(`branches: ${branches.map((b) => b.name).join(", ") || "(none)"}\n`);
        for (const s of saves) {
          process.stdout.write(`save ${s.label}: ${s.branch} @ ${s.eventId}\n`);
        }
        return 0;
      }
      case "save": {
        const slot = await engine.timeline.save(rest[0]);
        process.stdout.write(`${slot.label} → ${slot.branch} @ ${slot.eventId}\n`);
        return 0;
      }
      case "load": {
        const slot = rest[0];
        if (!slot) {
          process.stderr.write("Usage: animae timeline load <slot>\n");
          return 1;
        }
        await engine.timeline.load(slot);
        process.stdout.write(`Loaded ${slot}\n`);
        return 0;
      }
      case "rewind": {
        const to = rest[0];
        if (!to) {
          process.stderr.write("Usage: animae timeline rewind <eventId>\n");
          return 1;
        }
        const b = await engine.timeline.rewind(to);
        process.stdout.write(`Rewound; active branch ${b.name}\n`);
        return 0;
      }
      case "switch": {
        const b = rest[0];
        if (!b) {
          process.stderr.write("Usage: animae timeline switch <branch>\n");
          return 1;
        }
        await engine.timeline.switch(b);
        process.stdout.write(`Switched to ${b}\n`);
        return 0;
      }
      case "diff": {
        const [a, b] = rest;
        if (!a || !b) {
          process.stderr.write("Usage: animae timeline diff <branchA> <branchB>\n");
          return 1;
        }
        const diff = await engine.timeline.diff(a, b);
        process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
        return 0;
      }
      case "prune": {
        const b = rest[0];
        if (!b) {
          process.stderr.write("Usage: animae timeline prune <branch>\n");
          return 1;
        }
        await engine.timeline.prune(b);
        process.stdout.write(`Pruned ${b}\n`);
        return 0;
      }
      case "export": {
        const b = rest[0] ?? engine.timeline.current().name;
        let recordings = false;
        let file: string | undefined;
        for (let i = 1; i < rest.length; i++) {
          if (rest[i] === "--recordings") recordings = true;
          else if (rest[i] === "--file" && rest[i + 1]) file = rest[++i];
        }
        const out = await engine.timeline.export(b, { recordings, file });
        process.stdout.write(`${out}\n`);
        return 0;
      }
      case "import": {
        const file = rest[0];
        if (!file) {
          process.stderr.write("Usage: animae timeline import <file>\n");
          return 1;
        }
        const br = await engine.timeline.import(file);
        process.stdout.write(`Imported branch ${br.name}\n`);
        return 0;
      }
      case "replay": {
        const b = rest[0] ?? engine.timeline.current().name;
        let from: string | undefined;
        let to: string | undefined;
        for (let i = 1; i < rest.length; i++) {
          if (rest[i] === "--from" && rest[i + 1]) from = rest[++i];
          else if (rest[i] === "--to" && rest[i + 1]) to = rest[++i];
        }
        for await (const chunk of engine.timeline.replay(b, { from, to })) {
          if (chunk.type === "text") process.stdout.write(chunk.text);
          else if (chunk.type === "cue") process.stdout.write(` [${chunk.cue.type}: ${JSON.stringify(chunk.cue.args)}]`);
          else if (chunk.type === "done") process.stdout.write("\n");
        }
        return 0;
      }
      default:
        process.stderr.write(`Unknown timeline subcommand: ${sub}\n`);
        return 1;
    }
  } catch (err) {
    printError(err);
    return 1;
  } finally {
    await engine.close();
  }
}
