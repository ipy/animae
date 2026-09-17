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

EN_FORBIDDEN_IN_ZH = (
    "Side panel",
    "Participants",
    "Tracks",
    "Beat / anchors",
    "Help (F1)",
    "No visible fields",
    "Please enlarge",
)

ZH_MARKERS = ("侧栏", "帮助 (F1)", "参与者")

EN_MARKERS = ("Side panel", "Help (F1)", "Participants")

CJK_UI = ("\u4e00", "\u8bf7", "\u5e2e", "\u4fa7")


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


def _assert_no_cjk_ui(screen: str, label: str) -> None:
    for ch in CJK_UI:
        if ch in screen:
            raise AssertionError(f"{label}: unexpected CJK UI char {ch!r}")


def run_locale(initial: str, *, batch: str = "sidepanel") -> None:
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
        if initial.startswith("zh"):
            _assert_none(screen, EN_FORBIDDEN_IN_ZH, f"zh-CN boot ({batch})")
            _assert_any(screen, ZH_MARKERS, f"zh-CN boot ({batch})")
        else:
            _assert_any(screen, EN_MARKERS, f"en boot ({batch})")
            _assert_no_cjk_ui(screen, f"en boot ({batch})")
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
        sess.write(b":lang zh-CN\n")
        deadline = time.time() + 4.0
        while time.time() < deadline:
            if "界面语言" in _screen(sess) or "侧栏" in _screen(sess):
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
    run_locale("zh-CN", batch="sidepanel")
    run_locale("en", batch="sidepanel")
    run_lang_switch()
    sys.stderr.write("pty_locale_harness: OK\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
