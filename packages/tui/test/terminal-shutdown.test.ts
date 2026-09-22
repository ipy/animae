import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Animae repo root (`packages/tui/test` → `../../..`). */
const ANIMae_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const TUI_PKG = join(ANIMae_ROOT, "packages/tui");
const DEV_SESSION = join(TUI_PKG, "scripts/dev-session.ts");
const TUI_SCRIPTS = join(TUI_PKG, "scripts");
const CLI_DIST = join(ANIMae_ROOT, "dist", "animae");

function psCpu(pid: number): number {
  const out = Bun.spawnSync(["ps", "-p", String(pid), "-o", "%cpu="]).stdout.toString().trim();
  return out ? Number(out) : 0;
}

describe("terminal hangup", () => {
  test(
    "dev-session TUI exits within 2s when PTY master fd closes (detach_master)",
    async () => {
      const py = `
import os, sys, time, subprocess
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(TUI_SCRIPTS)})
from pty_lib import spawn_pty
root = Path(${JSON.stringify(ANIMae_ROOT)})
dev = Path(${JSON.stringify(DEV_SESSION)})
sess = spawn_pty(["bun", "run", str(dev), "--batch", "help"], env={**os.environ, "TERM": "xterm-256color"}, cwd=str(root))
time.sleep(2.0)
sess.detach_master()
deadline = time.time() + 2.5
while time.time() < deadline and sess.proc.poll() is None:
    time.sleep(0.05)
alive = sess.proc.poll() is None
if alive:
    sess.kill_process_group()
    raise SystemExit(2)
`;
      const proc = Bun.spawn(["python3", "-c", py], {
        cwd: ANIMae_ROOT,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      const err = await new Response(proc.stderr).text();
      expect(code).toBe(0);
      if (code !== 0) console.error(err);
    },
    20_000,
  );

  test(
    "dev-session TUI exits within 2s when PTY master closes (no CPU spin)",
    async () => {
      const env = { ...process.env, TERM: "xterm-256color" };
      const proc = Bun.spawn(["bun", "run", DEV_SESSION, "--batch", "help"], {
        cwd: ANIMae_ROOT,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const pid = proc.pid;
      expect(pid).toBeGreaterThan(0);
      await Bun.sleep(800);
      proc.kill("SIGHUP");
      const deadline = Date.now() + 2500;
      let code: number | null = null;
      const wait = proc.exited.then((c) => {
        code = c;
      });
      await Promise.race([wait, Bun.sleep(2500)]);
      expect(code).not.toBeNull();
      const cpu = psCpu(pid);
      expect(cpu).toBeLessThan(5);
    },
    15_000,
  );

  test(
    "compiled animae CLI exits within 2s when PTY master fd closes",
    async () => {
      if (!existsSync(CLI_DIST)) return;
      const py = `
import os, sys, time, subprocess
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(TUI_SCRIPTS)})
from pty_lib import spawn_pty
root = Path(${JSON.stringify(ANIMae_ROOT)})
binary = Path(${JSON.stringify(CLI_DIST)})
sess = spawn_pty([str(binary), "--help"], env={**os.environ, "TERM": "xterm-256color"}, cwd=str(root))
time.sleep(1.0)
sess.detach_master()
deadline = time.time() + 2.5
while time.time() < deadline and sess.proc.poll() is None:
    time.sleep(0.05)
alive = sess.proc.poll() is None
if alive:
    sess.kill_process_group()
    raise SystemExit(2)
`;
      const proc = Bun.spawn(["python3", "-c", py], {
        cwd: ANIMae_ROOT,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      expect(code).toBe(0);
    },
    25_000,
  );
});
