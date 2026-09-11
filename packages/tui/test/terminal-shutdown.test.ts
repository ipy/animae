import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const GAME = join(REPO, "games/lilium");
const MAIN = join(GAME, "src/main.ts");
const DATA = join(GAME, "data");

function psCpu(pid: number): number {
  const out = Bun.spawnSync(["ps", "-p", String(pid), "-o", "%cpu="]).stdout.toString().trim();
  return out ? Number(out) : 0;
}

describe("terminal hangup", () => {
  test(
    "dev lilium exits within 2s when PTY master fd closes (detach_master)",
    async () => {
      const tuiScripts = join(REPO, "animae/packages/tui/scripts");
      const py = `
import os, sys, time, tempfile, subprocess
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(tuiScripts)})
from pty_lib import spawn_pty
repo = Path(${JSON.stringify(REPO)})
main = repo / "games/lilium/src/main.ts"
data = repo / "games/lilium/data"
stub = repo / "games/lilium/scripts/dev/stub-openai-server.ts"
port = "9866"
stub_proc = subprocess.Popen(["bun", "run", str(stub)], env={**os.environ, "STUB_PORT": port}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.4)
home = tempfile.mkdtemp(prefix="hangup-home-")
cfg = tempfile.mkdtemp(prefix="hangup-cfg-")
(Path(cfg) / "config.yaml").write_text(
    f"models:\\n  s1:\\n    provider: openai-compatible\\n    model: stub\\n    baseURL: http://127.0.0.1:{port}/v1\\n    apiKey: test\\n  s2:\\n    provider: openai-compatible\\n    model: stub\\n    baseURL: http://127.0.0.1:{port}/v1\\n    apiKey: test\\nmodelMode: record\\ntypewriter: false\\n",
    encoding="utf-8",
)
env = os.environ.copy()
env["TERM"] = "xterm-256color"
env["LILIUM_HOME"] = home
env["LILIUM_CONFIG"] = cfg
env["HOST_PTY_WIZARD_ANSWER"] = "Test\\n"
sess = spawn_pty(["bun", "run", str(main), "new", "--root", str(data)], env=env, cwd=str(repo))
time.sleep(2.0)
sess.detach_master()
deadline = time.time() + 2.5
while time.time() < deadline and sess.proc.poll() is None:
    time.sleep(0.05)
alive = sess.proc.poll() is None
stub_proc.terminate()
try:
    stub_proc.wait(timeout=2)
except subprocess.TimeoutExpired:
    stub_proc.kill()
if alive:
    sess.kill_process_group()
    raise SystemExit(2)
`;
      const proc = Bun.spawn(["python3", "-c", py], {
        cwd: REPO,
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
    "dev lilium exits within 2s when PTY master closes (no CPU spin)",
    async () => {
      const env = { ...process.env, TERM: "xterm-256color" };
      const proc = Bun.spawn(["bun", "run", MAIN, "new", "--root", DATA], {
        cwd: REPO,
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
    "compiled lilium exits within 2s when PTY master fd closes",
    async () => {
      const dist = join(GAME, "dist/lilium");
      if (!existsSync(dist)) return;
      const tuiScripts = join(REPO, "animae/packages/tui/scripts");
      const py = `
import os, sys, time, tempfile, subprocess
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(tuiScripts)})
from pty_lib import spawn_pty
repo = Path(${JSON.stringify(REPO)})
binary = repo / "games/lilium/dist/lilium"
stub = repo / "games/lilium/scripts/dev/stub-openai-server.ts"
port = "9867"
stub_proc = subprocess.Popen(["bun", "run", str(stub)], env={**os.environ, "STUB_PORT": port}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.4)
home = tempfile.mkdtemp(prefix="hangup-dist-home-")
cfg = tempfile.mkdtemp(prefix="hangup-dist-cfg-")
(Path(cfg) / "config.yaml").write_text(
    f"models:\\n  s1:\\n    provider: openai-compatible\\n    model: stub\\n    baseURL: http://127.0.0.1:{port}/v1\\n    apiKey: test\\n  s2:\\n    provider: openai-compatible\\n    model: stub\\n    baseURL: http://127.0.0.1:{port}/v1\\n    apiKey: test\\nmodelMode: record\\ntypewriter: false\\n",
    encoding="utf-8",
)
env = os.environ.copy()
env["TERM"] = "xterm-256color"
env["LILIUM_HOME"] = home
env["LILIUM_CONFIG"] = cfg
env["HOST_PTY_WIZARD_ANSWER"] = "Test\\n"
sess = spawn_pty([str(binary), "new"], env=env, cwd=str(repo / "games/lilium"))
time.sleep(2.5)
sess.detach_master()
deadline = time.time() + 2.5
while time.time() < deadline and sess.proc.poll() is None:
    time.sleep(0.05)
alive = sess.proc.poll() is None
stub_proc.terminate()
try:
    stub_proc.wait(timeout=2)
except subprocess.TimeoutExpired:
    stub_proc.kill()
if alive:
    sess.kill_process_group()
    raise SystemExit(2)
`;
      const proc = Bun.spawn(["python3", "-c", py], {
        cwd: REPO,
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
