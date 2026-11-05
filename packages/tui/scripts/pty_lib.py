"""Shared PTY session: background reader (avoids pipe backpressure) + optional pyte screen."""
from __future__ import annotations

import codecs
import fcntl
import os
import pty
import signal
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
    draft_file: str | None = None
    _master_open: bool = True

    def __enter__(self) -> PtySession:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self.close()
        return False

    def start_reader(self, *, use_pyte: bool = True) -> None:
        if use_pyte:
            screen, Stream = try_pyte_screen(self.cols, self.rows)
            if screen is not None and Stream is not None:
                self.screen = screen
                self._stream = Stream(screen)

        # A read can end in the middle of a multi-byte character; decoding each chunk on its own turns the
        # halves into U+FFFD and shifts every later column of the emulated screen.
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")

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
                        self._stream.feed(decoder.decode(chunk))
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
        if not self._master_open:
            return
        try:
            os.write(self.master, data)
        except OSError:
            self._master_open = False

    @property
    def master_writable(self) -> bool:
        return self._master_open

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
        for i in range(len(lines) - 1, -1, -1):
            line = lines[i]
            s = line.strip()
            if not s.startswith(">"):
                continue
            body = s[1:].strip()
            if body.endswith("(Tab to focus)"):
                body = body[: -len("(Tab to focus)")].strip()
            if "╭" in body or "┌" in body or "─" in body:
                continue
            parts: list[str] = []
            if body:
                parts.append(body)
            j = i + 1
            while j < len(lines):
                raw = lines[j]
                cont = raw.strip()
                if not cont or "╭" in cont or cont.startswith(">"):
                    break
                if "F1/" in cont or "Side panel" in cont:
                    break
                # Transcript wraps use wide space padding; input continuations do not.
                if re.search(r"  {4,}", raw):
                    break
                parts.append(cont)
                j += 1
            return "".join(parts)
        return ""

    def resize(self, cols: int, rows: int) -> None:
        self.cols = cols
        self.rows = rows
        set_winsize(self.master, rows, cols)
        if self.proc.poll() is None:
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGWINCH)
            except (ProcessLookupError, PermissionError, OSError):
                pass
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

    def _read_draft_file(self) -> str:
        path = self.draft_file
        if not path:
            return ""
        try:
            text = Path(path).read_text(encoding="utf-8")
        except OSError:
            return ""
        lines = text.splitlines()
        return lines[0] if lines else ""

    def turn_pending(self) -> bool:
        path = self.draft_file
        if not path:
            return False
        try:
            lines = Path(path).read_text(encoding="utf-8").splitlines()
        except OSError:
            return False
        return len(lines) > 2 and lines[2].strip() == "1"

    def wait_shell_ready(self, *, timeout: float = 150.0) -> None:
        """Input draft empty and no in-flight LLM turn (PTY harness mirror)."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError("process exited while waiting for shell")
            draft = self.find_input_draft().strip()
            if not draft and not self.turn_pending() and self.input_focused():
                return
            time.sleep(0.2)
        raise TimeoutError(
            f"shell not ready draft={self.find_input_draft()!r} pending={self.turn_pending()}\n"
            + self.plain_tail(400)
        )

    def wait_turn_done(self, *, start_timeout: float = 3.0, timeout: float = 90.0) -> None:
        """
        Wait for a just-submitted turn to start and finish (PTY harness mirror). The turn-pending flag lags the Enter
        key a little, and the first words of a reply show up before the turn is over, so neither the flag alone nor the
        reply text is enough: colon commands sent too early are refused ("one turn at a time"). Focus is not checked: a
        finished turn may leave a choice list focused, and callers move focus back to the input themselves.
        """
        deadline = time.time() + start_timeout
        while time.time() < deadline and not self.turn_pending():
            time.sleep(0.05)
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError("process exited while waiting for the turn")
            if not self.turn_pending():
                return
            time.sleep(0.1)
        raise TimeoutError("turn still pending after %.0fs\n" % timeout + self.plain_tail(400))

    def find_input_draft(self, expected_substr: str | None = None) -> str:
        mirrored = self._read_draft_file()
        if mirrored != "" or (self.draft_file and Path(self.draft_file).is_file()):
            return mirrored
        draft = self.input_line_from_screen()
        if expected_substr and draft and len(draft) > len(expected_substr) + 24:
            draft = ""
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
                    if "F1/" in cont or "Side panel" in cont:
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
        if not self.draft_file:
            compact = re.sub(r"\s+", "", self.plain_tail(3200))
            want = re.sub(r"\s+", "", expected)
            if want and len(want) >= 4 and len(want) <= 32 and want in compact:
                return True
        return False

    def input_focused(self) -> bool:
        if self.screen is not None:
            # The live screen is authoritative: the raw output history keeps stale "(Tab to focus)" hints that the
            # terminal has long since repainted away.
            for line in reversed(self.screen_lines()[-12:]):
                s = line.strip()
                if s.startswith(">"):
                    return "(Tab to focus)" not in s
            return True
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

    def focus_input(self, *, tries: int = 10) -> None:
        """Esc / Tab from choice menu or side panel back to the input line."""
        for _ in range(tries):
            if self.input_focused():
                return
            self.write(b"\x1b")
            time.sleep(0.08)
        for _ in range(tries):
            if self.input_focused():
                return
            tail = self.plain_tail(700)
            if "(Tab to focus)" in tail:
                self.write(b"\t")
                time.sleep(0.1)
            else:
                self.write(b"\x1b")
                time.sleep(0.08)
        if not self.input_focused():
            raise RuntimeError(
                "input line not focused after Esc/Tab\n" + self.plain_tail(800)
            )

    def kill_process_group(self, sig: int = signal.SIGTERM) -> None:
        if self.proc.poll() is not None:
            return
        try:
            pgid = os.getpgid(self.proc.pid)
            os.killpg(pgid, sig)
        except (ProcessLookupError, PermissionError, OSError):
            try:
                self.proc.send_signal(sig)
            except OSError:
                pass

    def detach_master(self) -> None:
        """Close PTY master only (SIGHUP to session); for hangup regression tests."""
        self.stop()
        try:
            os.close(self.master)
        except OSError:
            pass
        self._master_open = False

    def close(self) -> None:
        self.stop()
        if self.proc.poll() is None:
            self.kill_process_group(signal.SIGTERM)
            try:
                self.proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                self.kill_process_group(signal.SIGKILL)
                try:
                    self.proc.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    pass
        try:
            os.close(self.master)
        except OSError:
            pass
        self._master_open = False


def spawn_host_dist(
    *,
    repo_root: Path,
    cols: int = 120,
    rows: int = 40,
    port: str = "9878",
) -> tuple[PtySession, subprocess.Popen[bytes], str, str]:
    """Compiled host application binary (`new`) with temp home/config and stub LLM.

    Requires ``HOST_PTY_BIN`` and ``HOST_PTY_STUB`` (absolute paths); the embedding project's build or CI sets them.
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
    env["HOST_PTY_WIZARD_ANSWER"] = "Test\n"
    env["HOST_PTY_WIZARD_PROMPT"] = "Protagonist display name"
    env, draft_path = attach_pty_draft_mirror(env)
    sess = spawn_pty([str(binary), "new"], env=env, cwd=str(repo_root), cols=cols, rows=rows)
    sess.draft_file = draft_path
    return sess, stub_proc, home, cfg


def _protagonist_name_wizard_active(plain: str) -> bool:
    """True only while the readline name prompt is waiting (not after answer scrolled away)."""
    tail = plain[-500:]
    if _shell_ui_markers(tail):
        return False
    custom = os.environ.get("HOST_PTY_WIZARD_PROMPT", "").strip()
    for line in reversed(plain.splitlines()[-10:]):
        s = line.strip()
        if not s:
            continue
        if custom and custom in s:
            return True
        if any(
            m in s
            for m in (
                "Protagonist display name",
                "Warden]:",
            )
        ):
            return True
        break
    return False


def _shell_ui_markers(plain: str) -> bool:
    return any(
        m in plain
        for m in (
            "F1/",
            "Side panel",
            ">",
            "Demo session",
        )
    )


def wizard_answer_bytes() -> bytes:
    raw = os.environ.get("HOST_PTY_WIZARD_ANSWER", "Test\n")
    if not isinstance(raw, str) or not raw.strip():
        raw = "Test\n"
    if raw.endswith("\\n") or ("\\n" in raw and "\n" not in raw):
        raw = raw.replace("\\n", "\n")
    if not raw.endswith("\n"):
        raw = f"{raw}\n"
    return raw.encode("utf-8")


def wait_host_main_ui(sess: PtySession, timeout: float = 120.0, *, allow_config_wizard: bool = False) -> None:
    """Wait for optional name wizard + intro skip, then TUI shell markers.

    A config wizard in the transcript means the host did not load its config, unless the caller has just driven that
    wizard in this very session (``allow_config_wizard``).
    """
    wizard_answer = wizard_answer_bytes()
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
        wizard_markers = [
            m.strip()
            for m in os.environ.get(
                "HOST_PTY_CONFIG_WIZARD_MARKERS",
                "Choose model provider,First run — configuration wizard",
            ).split(",")
            if m.strip()
        ]
        if not allow_config_wizard and any(m in plain for m in wizard_markers):
            raise TimeoutError(
                "Config wizard appeared — host config env not loaded; "
                f"check env {os.environ.get('HOST_PTY_CONFIG_VAR', 'HOST_CONFIG')} "
                f"and file at {plain[:200]!r}"
            )
        if not name_done and _protagonist_name_wizard_active(plain):
            if time.time() - last_name_send > 0.8:
                sess.write(wizard_answer)
                last_name_send = time.time()
            if last_name_send > 0 and time.time() - last_name_send < 0.4:
                time.sleep(0.06)
                continue
        if not name_done and last_name_send > 0 and time.time() - last_name_send > 0.35:
            name_done = True
            intro_at = time.time()
        if not name_done and _shell_ui_markers(plain):
            name_done = True
            intro_at = time.time()
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


def attach_pty_draft_mirror(env: dict[str, str]) -> tuple[dict[str, str], str]:
    """Expose input draft on disk — Ink absolute layout breaks pyte line parsing."""
    import tempfile

    fd, path = tempfile.mkstemp(prefix="animae-pty-draft-", text=True)
    os.close(fd)
    out = dict(env)
    out["TUI_PTY_DRAFT_FILE"] = path
    out.setdefault("TUI_PTY_DRIVER", "1")
    return out, path


def choice_menu_visible(sess: PtySession) -> bool:
    view = "\n".join(sess.screen_lines()) if sess.screen else sess.plain_tail(2400)
    return "▸" in view or "└▸" in view


def ensure_free_roam_shell(sess: PtySession, *, timeout: float = 45.0) -> None:
    """Leave opening scene / choice menu and focus the command input line."""
    wait_host_main_ui(sess, timeout=timeout)
    time.sleep(0.25)
    sess.write(b" ")
    time.sleep(0.2)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if choice_menu_visible(sess):
            for _ in range(3):
                sess.write(b"\x1b")
                time.sleep(0.1)
        sess.write(b":leave\n")
        time.sleep(0.7)
        if choice_menu_visible(sess):
            continue
        if not choice_menu_visible(sess):
            try:
                sess.focus_input()
                return
            except RuntimeError:
                sess.write(b"\t")
                time.sleep(0.15)
        time.sleep(0.08)
    sess.focus_input()


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
