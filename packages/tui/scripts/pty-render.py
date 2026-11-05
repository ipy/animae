#!/usr/bin/env python3
"""Run TUI dev-session in a PTY at several sizes; save text grids for UX review."""
from __future__ import annotations

import fcntl
import json
import os
import pty
import re
import select
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAP = ROOT.parent.parent / "docs" / "tui-snapshots"
QA_KEYS = json.loads((ROOT / "scripts" / "qa-scenario-keys.json").read_text(encoding="utf-8"))
SCENARIOS = [
    "empty",
    "scene-start",
    "typewriter-mid",
    "typewriter-done",
    "wide",
    "choices",
    "sidepanel",
    "help",
    "event-log",
    "timeline",
    "explain",
    "inspector",
    "long-scroll",
    "narrow",
    "model-error",
    "rewind",
    "rapid-input",
    "resize-mid",
]
SIZES = [(120, 40), (100, 30), (90, 30), (79, 23), (160, 50)]
TIOCSWINSZ = 0x80087467
ANSI_RE = re.compile(
    r"\x1b\[[0-9;?]*[ -/]*[@-~]"
    r"|\x1b\][^\x07]*(\x07|\x1b\\)"
    r"|\x1b[@-_]"
    r"|\x1b."
)


def set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def strip_ansi(data: str) -> str:
    return ANSI_RE.sub("", data)


def extract_grid(raw: bytes, cols: int, rows: int) -> str:
    """Best-effort final frame: last Ink synchronized update, then strip ANSI."""
    text = raw.decode("utf-8", errors="replace")
    start = text.rfind("\x1b[?2026h")
    end = text.rfind("\x1b[?2026l")
    if start != -1 and end != -1 and end > start:
        text = text[start + len("\x1b[?2026h") : end]
    plain = strip_ansi(text).replace("\r\n", "\n").replace("\r", "\n")
    lines = plain.split("\n")
    # Drop trailing empty noise from exit sequences
    while lines and not lines[-1].strip():
        lines.pop()
    body = lines[-rows:] if len(lines) >= rows else lines
    while len(body) < rows:
        body.insert(0, "")
    grid: list[str] = []
    for line in body[-rows:]:
        grid.append(line.ljust(cols)[:cols])
    return "\n".join(grid) + "\n"


def schedule_pty_keys(
    master: int,
    name: str,
    cols: int,
    rows: int,
    ready_event: threading.Event,
    input_done: threading.Event,
) -> None:
    spec = QA_KEYS.get(name)
    if not spec or not spec.get("keys"):
        input_done.set()
        return

    def pump() -> None:
        try:
            if not ready_event.wait(timeout=45):
                return
            time.sleep(spec.get("readyMs", 450) / 1000.0)
            delay = spec.get("delayMs", 400) / 1000.0
            resize_at = None
            if name == "resize-mid":
                resize_at = time.time() + delay * 0.6
            for key in spec["keys"]:
                if resize_at is not None and time.time() >= resize_at:
                    set_winsize(master, max(79, cols - 20), max(23, rows - 5))
                    resize_at = None
                try:
                    os.write(master, key.encode("utf-8"))
                except OSError:
                    return
                time.sleep(delay)
        finally:
            input_done.set()

    threading.Thread(target=pump, daemon=True).start()


def scenario_deadline(name: str) -> float:
    spec = QA_KEYS.get(name) or {}
    keys = spec.get("keys") or []
    delay = spec.get("delayMs", 400) / 1000.0
    ready = spec.get("readyMs", 450) / 1000.0
    return 50 + ready + max(0, len(keys)) * delay + 8


def run_scenario(name: str, cols: int, rows: int) -> str:
    out = SNAP / f"{name}-{cols}x{rows}.txt"
    master, slave = pty.openpty()
    set_winsize(master, rows, cols)
    env = os.environ.copy()
    env["COLUMNS"] = str(cols)
    env["LINES"] = str(rows)
    env["TERM"] = "xterm-256color"
    env["TUI_PTY_DRIVER"] = "1"
    cmd = [
        "bun",
        "run",
        str(ROOT / "scripts" / "dev-session.ts"),
        "--batch",
        name,
        "--cols",
        str(cols),
        "--rows",
        str(rows),
    ]
    proc = subprocess.Popen(
        cmd,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=env,
        cwd=str(ROOT),
        close_fds=True,
        preexec_fn=os.setsid,
    )
    os.close(slave)
    ready_event = threading.Event()
    input_done = threading.Event()
    schedule_pty_keys(master, name, cols, rows, ready_event, input_done)
    chunks: list[bytes] = []
    idle_since = time.time()
    deadline = time.time() + scenario_deadline(name)
    while time.time() < deadline:
        r, _, _ = select.select([master], [], [], 0.15)
        if master in r:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            chunks.append(chunk)
            idle_since = time.time()
            if b"TUI_READY" in b"".join(chunks):
                ready_event.set()
        if proc.poll() is not None:
            break
        if input_done.is_set() and time.time() - idle_since > 3.5 and chunks:
            try:
                os.write(master, b"\x03")
            except OSError:
                pass
            idle_since = time.time() + 999
    while proc.poll() is None and time.time() < deadline + 3:
        r, _, _ = select.select([master], [], [], 0.1)
        if master in r:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if chunk:
                chunks.append(chunk)
        else:
            try:
                os.write(master, b"\x03")
            except OSError:
                pass
            break
    os.close(master)
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
    grid = extract_grid(b"".join(chunks), cols, rows)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(grid, encoding="utf-8")
    return str(out)


def main() -> None:
    SNAP.mkdir(parents=True, exist_ok=True)
    only = [s.strip() for s in os.environ.get("TUI_SNAPSHOT_SCENARIOS", "").split(",") if s.strip()]
    scenarios = [s for s in SCENARIOS if not only or s in only]
    for name in scenarios:
        for cols, rows in SIZES:
            path = run_scenario(name, cols, rows)
            print(path, flush=True)


if __name__ == "__main__":
    main()
