#!/usr/bin/env python3
"""PTY gate: TUI chrome follows UI locale and :lang switches at runtime."""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

PKG = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PKG / "scripts"))
from pty_lib import PtySession, spawn_pty  # noqa: E402

DEV_SESSION = PKG / "scripts" / "dev-session.ts"

EN_MARKERS = ("Side panel", "Help (F1)", "Participants")

EN_FORBIDDEN_IN_FR = (
    "Side panel",
    "Participants",
    "Tracks",
    "Beat / anchors",
    "Help (F1)",
    "No visible fields",
    "Please enlarge",
)

FR_MARKERS = ("Panneau latéral", "Aide (F1)", "Personnes")


def _screen(sess: PtySession) -> str:
    lines = sess.screen_lines()
    if lines:
        return "\n".join(lines)
    return sess.plain_tail(3200)


def _wait_ready(sess: PtySession, timeout: float = 45.0) -> None:
    if not sess.wait_text("TUI_READY", timeout=timeout):
        raise AssertionError("TUI_READY not seen")


def _assert_none(screen: str, needles: tuple[str, ...], label: str) -> None:
    for n in needles:
        if n in screen:
            raise AssertionError(f"{label}: forbidden {n!r} in screen")


def _assert_any(screen: str, needles: tuple[str, ...], label: str) -> None:
    if not any(n in screen for n in needles):
        raise AssertionError(f"{label}: expected one of {needles!r}\n{screen[-800:]}")


def run_locale(initial: str, *, batch: str = "sidepanel", fr_markers: tuple[str, ...] = FR_MARKERS) -> None:
    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["TUI_PTY_DRIVER"] = "1"
    env["ANIMAE_LOCALE"] = initial
    env["COLUMNS"] = "120"
    env["LINES"] = "40"
    sess = spawn_pty(
        ["bun", "run", str(DEV_SESSION), "--batch", batch],
        env=env,
        cwd=str(PKG),
    )
    try:
        _wait_ready(sess)
        time.sleep(0.45)
        screen = _screen(sess)
        if initial.startswith("fr"):
            _assert_none(screen, EN_FORBIDDEN_IN_FR, f"fr boot ({batch})")
            _assert_any(screen, fr_markers, f"fr boot ({batch})")
        else:
            _assert_any(screen, EN_MARKERS, f"en boot ({batch})")
    finally:
        sess.write(b":quit\n")
        try:
            sess.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            sess.write(b"\x03")
            sess.proc.wait(timeout=5)
        sess.close()


def run_lang_switch() -> None:
    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["TUI_PTY_DRIVER"] = "1"
    env["ANIMAE_LOCALE"] = "en"
    env["COLUMNS"] = "120"
    env["LINES"] = "40"
    sess = spawn_pty(
        ["bun", "run", str(DEV_SESSION), "--batch", "empty"],
        env=env,
        cwd=str(PKG),
    )
    try:
        _wait_ready(sess)
        time.sleep(0.35)
        _assert_any(_screen(sess), ("Help (F1)", "Side panel"), "en before switch")
        sess.write(b":lang fr\n")
        deadline = time.time() + 4.0
        while time.time() < deadline:
            scr = _screen(sess)
            if "Panneau latéral" in scr or "Langue définie" in scr:
                break
            time.sleep(0.06)
        sess.write(b":lang en\n")
        deadline = time.time() + 4.0
        while time.time() < deadline:
            scr = _screen(sess)
            if "UI language" in scr or "Side panel" in scr:
                break
            time.sleep(0.06)
        _assert_any(_screen(sess), EN_MARKERS, "en after :lang en")
    finally:
        sess.write(b":quit\n")
        try:
            sess.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            sess.write(b"\x03")
            sess.proc.wait(timeout=5)
        sess.close()


def main() -> int:
    run_locale("fr", batch="sidepanel")
    run_locale("en", batch="sidepanel")
    run_lang_switch()
    sys.stderr.write("pty_locale_harness: OK\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
