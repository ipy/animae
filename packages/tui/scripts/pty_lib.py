"""Shared PTY session: background reader (avoids pipe backpressure) + optional pyte screen."""
from __future__ import annotations

import fcntl
import os
import pty
import re
import select
import struct
import subprocess
import sys
import termios
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

_VENDOR = Path(__file__).resolve().parent / "vendor"
if _VENDOR.is_dir():
    sys.path.insert(0, str(_VENDOR))

ANSI_RE = re.compile(
    r"\x1b\[[0-9;?]*[ -/]*[@-~]"
    r"|\x1b\][^\x07]*(\x07|\x1b\\)"
    r"|\x1b[NO][A-Za-z~]"
    r"|\x1b."
)


def set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def strip_ansi(data: str) -> str:
    return ANSI_RE.sub("", data)


def try_pyte_screen(cols: int, rows: int):
    try:
        import pyte

        return pyte.Screen(cols, rows), pyte.Stream
    except ImportError:
        return None, None


@dataclass
class PtySession:
    master: int
    proc: subprocess.Popen[bytes]
    buf: bytearray = field(default_factory=bytearray)
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None
    cols: int = 120
    rows: int = 40
    screen: object | None = None
    _stream: Callable[..., object] | None = None

    def start_reader(self, *, use_pyte: bool = True) -> None:
        if use_pyte:
            screen, Stream = try_pyte_screen(self.cols, self.rows)
            if screen is not None and Stream is not None:
                self.screen = screen
                self._stream = Stream(screen)

        def loop() -> None:
            while not self._stop.is_set():
                if self.proc.poll() is not None:
                    time.sleep(0.02)
                    continue
                r, _, _ = select.select([self.master], [], [], 0.04)
                if self.master not in r:
                    continue
                try:
                    chunk = os.read(self.master, 65536)
                except OSError:
                    break
                if not chunk:
                    continue
                with self._lock:
                    self.buf.extend(chunk)
                if self._stream is not None:
                    try:
                        self._stream.feed(chunk.decode("utf-8", errors="replace"))
                    except Exception:
                        pass

        self._lock = threading.Lock()
        self._thread = threading.Thread(target=loop, name="pty-reader", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    def write(self, data: bytes) -> None:
        os.write(self.master, data)

    def plain(self) -> str:
        with self._lock:
            return strip_ansi(self.buf.decode("utf-8", errors="replace"))

    def plain_tail(self, n: int = 2000) -> str:
        raw = self.plain()
        return raw[-n:] if len(raw) > n else raw

    def wait_text(
        self,
        needle: str,
        timeout: float = 30.0,
        *,
        plain: Callable[[], str] | None = None,
    ) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                return needle in (plain() if plain else self.plain())
            text = plain() if plain else self.plain()
            if needle in text:
                return True
            time.sleep(0.04)
        return needle in (plain() if plain else self.plain())

    def screen_lines(self) -> list[str]:
        if self.screen is None:
            return self.plain().splitlines()
        display = getattr(self.screen, "display", None)
        if display is None:
            return self.plain().splitlines()
        return ["".join(row).rstrip() for row in display]

    def input_line_from_screen(self) -> str:
        lines = self.screen_lines()
        for line in reversed(lines):
            s = line.strip()
            if not s.startswith(">"):
                continue
            body = s[1:].strip()
            if body.endswith("(Tab to focus)"):
                body = body[: -len("(Tab to focus)")].strip()
            if "╭" in body or "┌" in body or "─" in body:
                continue
            return body
        return ""

    def resize(self, cols: int, rows: int) -> None:
        self.cols = cols
        self.rows = rows
        set_winsize(self.master, rows, cols)
        if self.screen is not None:
            try:
                import pyte

                self.screen = pyte.Screen(cols, rows)
                _, Stream = try_pyte_screen(cols, rows)
                if Stream is not None:
                    self._stream = Stream(self.screen)
                    self._stream.feed(strip_ansi(self.buf.decode("utf-8", errors="replace")))
            except Exception:
                pass

    def find_input_draft(self, expected_substr: str | None = None) -> str:
        draft = self.input_line_from_screen()
        if draft:
            return draft
        draft = self._draft_from_plain(expected_substr)
        if draft:
            return draft
        return ""

    def _draft_from_plain(self, expected_substr: str | None = None) -> str:
        lines = self.plain().splitlines()
        for i in range(len(lines) - 1, -1, -1):
            line = lines[i]
            if "╭" in line or "┌" in line or "F1/" in line or "TUI_READY" in line:
                continue
            s = line.strip()
            if s.startswith(">"):
                body = s[1:].strip()
                if body.endswith("(Tab to focus)"):
                    body = body[: -len("(Tab to focus)")].strip()
                if body.startswith(("┌", "│", "╭", "─")):
                    continue
                parts: list[str] = []
                if body:
                    parts.append(body)
                j = i + 1
                while j < len(lines):
                    cont = lines[j].strip()
                    if not cont or "╭" in cont or cont.startswith(">"):
                        break
                    if "F1/" in cont or "输入" in cont:
                        break
                    parts.append(cont)
                    j += 1
                joined = "".join(parts)
                if joined:
                    return joined
                return ""
            if expected_substr and s == expected_substr:
                return s
            if expected_substr and expected_substr in s and len(s) <= len(expected_substr) + 8:
                return s
        return ""

    def draft_matches(self, expected: str) -> bool:
        draft = self.find_input_draft(expected)
        if draft == expected:
            return True
        if expected and draft and expected.endswith(draft):
            return len(draft) >= min(24, len(expected) // 2)
        if expected and draft and expected in draft:
            return True
        compact = re.sub(r"\s+", "", self.plain_tail(3200))
        want = re.sub(r"\s+", "", expected)
        if want and len(want) >= 4 and want in compact:
            return True
        return False

    def input_focused(self) -> bool:
        tail = self.plain_tail(900)
        if "(Tab to focus)" in tail:
            return False
        for line in reversed(self.plain().splitlines()[-12:]):
            s = line.strip()
            if not s.startswith(">"):
                continue
            body = s[1:].strip()
            if "(Tab to focus)" in body:
                return False
            return True
        return True

    def focus_input(self, *, tries: int = 5) -> None:
        """Esc or Tab from choice menu / transcript focus back to the input line."""
        for _ in range(tries):
            if self.input_focused():
                return
            self.write(b"\x1b")
            time.sleep(0.06)
            if self.input_focused():
                return
            self.write(b"\t")
            time.sleep(0.1)
        if not self.input_focused():
            raise RuntimeError(
                "input line not focused after Esc/Tab\n" + self.plain_tail(800)
            )

    def close(self) -> None:
        self.stop()
        try:
            os.close(self.master)
        except OSError:
            pass


def spawn_host_dist(
    *,
    repo_root: Path,
    cols: int = 120,
    rows: int = 40,
    port: str = "9878",
) -> tuple[PtySession, subprocess.Popen[bytes], str, str]:
    """Compiled host game binary (`new`) with temp home/config and stub LLM.

    Requires ``HOST_PTY_BIN`` and ``HOST_PTY_STUB`` (absolute paths); set by the host monorepo build/CI.
    """
    import tempfile
    import textwrap

    bin_env = os.environ.get("HOST_PTY_BIN")
    stub_env = os.environ.get("HOST_PTY_STUB")
    if not bin_env or not stub_env:
        raise OSError("HOST_PTY_BIN and HOST_PTY_STUB must be set for dist PTY tests")
    binary = Path(bin_env)
    stub_script = Path(stub_env)
    if not binary.is_file():
        raise FileNotFoundError(binary)
    home = tempfile.mkdtemp(prefix="host-pty-home-")
    cfg = tempfile.mkdtemp(prefix="host-pty-cfg-")
    stub_run_env = os.environ.copy()
    stub_run_env["STUB_PORT"] = port
    stub_proc = subprocess.Popen(
        ["bun", "run", str(stub_script)],
        env=stub_run_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(0.4)
    cfg_file = Path(cfg, "config.yaml")
    cfg_file.write_text(
        textwrap.dedent(
            f"""
            models:
              s1:
                provider: openai-compatible
                model: stub
                baseURL: http://127.0.0.1:{port}/v1
                apiKey: test
              s2:
                provider: openai-compatible
                model: stub
                baseURL: http://127.0.0.1:{port}/v1
                apiKey: test
            modelMode: record
            typewriter: false
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )
    if not cfg_file.is_file():
        raise FileNotFoundError(f"host PTY config not written: {cfg_file}")
    env = os.environ.copy()
    home_var = os.environ.get("HOST_PTY_HOME_VAR", "HOST_HOME")
    cfg_var = os.environ.get("HOST_PTY_CONFIG_VAR", "HOST_CONFIG")
    env[home_var] = home
    env[cfg_var] = cfg
    env["TERM"] = "xterm-256color"
    sess = spawn_pty([str(binary), "new"], env=env, cwd=str(repo_root), cols=cols, rows=rows)
    return sess, stub_proc, home, cfg


def wait_host_main_ui(sess: PtySession, timeout: float = 120.0) -> None:
    """Wait for optional name wizard + intro skip, then TUI shell markers."""
    wizard_prompt = os.environ.get("HOST_PTY_WIZARD_PROMPT", "主角姓名")
    wizard_answer = os.environ.get("HOST_PTY_WIZARD_ANSWER", "测试\n")
    deadline = time.time() + timeout
    name_done = False
    skipped = False
    intro_at: float | None = None
    shell_markers = ("F1/", "Side panel", ">")
    last_name_send = 0.0
    while time.time() < deadline:
        if sess.proc.poll() is not None:
            break
        plain = sess.plain().replace("\r", "")
        if "选择模型提供商" in plain or "首次运行 — 进入配置向导" in plain:
            raise TimeoutError(
                "Config wizard appeared — LILIUM_CONFIG/config.yaml not loaded; "
                f"check env {os.environ.get('HOST_PTY_CONFIG_VAR', 'HOST_CONFIG')} "
                f"and file at {plain[:200]!r}"
            )
        if not name_done and wizard_prompt in plain:
            if time.time() - last_name_send > 0.8:
                sess.write(wizard_answer.encode("utf-8"))
                last_name_send = time.time()
            if "温室" in plain or "F1/" in plain or "输入" in plain:
                name_done = True
                intro_at = time.time()
            continue
        if not name_done and any(m in plain for m in shell_markers):
            name_done = True
            skipped = True
            return
        if name_done and not skipped and intro_at is not None:
            if any(m in plain for m in shell_markers) or time.time() - intro_at > 6.0:
                time.sleep(0.2)
                sess.write(b" ")
                skipped = True
                continue
        if skipped and any(m in plain for m in shell_markers):
            return
        time.sleep(0.06)
    if not any(m in sess.plain() for m in shell_markers):
        raise TimeoutError(f"Host main UI not ready: {sess.plain_tail(600)!r}")


def spawn_pty(
    cmd: list[str],
    *,
    env: dict[str, str],
    cwd: str | None = None,
    cols: int = 120,
    rows: int = 40,
) -> PtySession:
    master, slave = pty.openpty()
    set_winsize(slave, rows, cols)
    set_winsize(master, rows, cols)
    proc = subprocess.Popen(
        cmd,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=env,
        cwd=cwd,
        preexec_fn=os.setsid,
    )
    os.close(slave)
    sess = PtySession(master=master, proc=proc, cols=cols, rows=rows)
    sess.start_reader()
    return sess
