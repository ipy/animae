#!/usr/bin/env python3
"""PTY input gate: typing + keys (pty_lib background reader + pyte when vendored)."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

PKG = Path(__file__).resolve().parents[1]
REPO = PKG.parents[2]
sys.path.insert(0, str(PKG / "scripts"))
from pty_lib import (  # noqa: E402
    PtySession,
    ensure_free_roam_shell,
    spawn_host_dist,
    spawn_pty,
)

KEY = {
    "f1_ss3": b"\x1bOP",
    "f2_ss3": b"\x1bOQ",
    "f3_ss3": b"\x1bOR",
    "f4_ss3": b"\x1bOS",
    "f1_csi": b"\x1b[11~",
    "f2_csi": b"\x1b[12~",
    "f3_csi": b"\x1b[13~",
    "f4_csi": b"\x1b[14~",
    "esc": b"\x1b",
    "up_csi": b"\x1b[A",
    "up_ss3": b"\x1bOA",
    "down_csi": b"\x1b[B",
    "home_csi": b"\x1b[H",
    "end_csi": b"\x1b[F",
    "del_csi": b"\x1b[3~",
    "ctrl_p": b"\x10",
    "alt_1": b"\x1b1",
    "paste": b"\x1b[200~bracketed-paste-test\x1b[201~",
}

DEV_SESSION = PKG / "scripts" / "dev-session.ts"


def assert_draft(sess: PtySession, expected: str, label: str, timeout: float = 3.5) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if sess.draft_matches(expected):
            return
        tail = sess.plain_tail(1400)
        for line in tail.splitlines()[-8:]:
            if expected in line and "命令面板" not in line and "Help (" not in line:
                return
        time.sleep(0.04)
    got = sess.find_input_draft(expected)
    raise AssertionError(
        f"{label}: got {got!r} expected {expected!r}\n{sess.plain_tail(900)}"
    )


def _screen_view(sess: PtySession, *, tail_chars: int = 2800) -> str:
    lines = sess.screen_lines()
    if lines:
        return "\n".join(lines)
    return sess.plain_tail(tail_chars)


def help_visible(sess: PtySession) -> bool:
    view = _screen_view(sess)
    return "Help (F1)" in view or "帮助 (F1)" in view


def event_log_visible(sess: PtySession) -> bool:
    view = _screen_view(sess)
    return "Event log (F2)" in view or "事件日志 (F2)" in view


def overlay_visible(sess: PtySession, title: str) -> bool:
    return title in _screen_view(sess)


def wait_overlay_open(sess: PtySession, title: str, timeout: float = 2.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if overlay_visible(sess, title):
            return True
        time.sleep(0.04)
    return overlay_visible(sess, title)


def wait_overlay_closed(sess: PtySession, title: str, timeout: float = 1.2) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not overlay_visible(sess, title):
            return
        time.sleep(0.04)
    if overlay_visible(sess, title):
        raise AssertionError(f"overlay {title!r} still visible after Esc")


def open_help(sess: PtySession) -> str:
    """Return label of sequence that opened help."""
    for label, seq in (
        ("f1_ss3", KEY["f1_ss3"]),
        ("f1_csi", KEY["f1_csi"]),
        ("alt_1", KEY["alt_1"]),
    ):
        sess.write(seq)
        if help_visible(sess):
            return label
        sess.write(KEY["esc"])
        time.sleep(0.12)
    raise AssertionError("F1 / Alt+1 did not open help overlay")


def close_help_esc(sess: PtySession, budget_s: float = 0.35) -> float:
    t0 = time.perf_counter()
    sess.write(KEY["esc"])
    deadline = t0 + budget_s
    while time.perf_counter() < deadline:
        if not help_visible(sess):
            return time.perf_counter() - t0
        time.sleep(0.008)
    sess.write(KEY["esc"])
    deadline = t0 + budget_s + 0.25
    while time.perf_counter() < deadline:
        if not help_visible(sess):
            return time.perf_counter() - t0
        time.sleep(0.008)
    raise AssertionError(f"Esc did not close help within {(budget_s + 0.25) * 1000:.0f}ms")


def _exercise(sess: PtySession, quick: bool) -> dict:
    metrics: dict = {}
    sess.focus_input()

    if not quick:
        opened = open_help(sess)
        metrics["help_via"] = opened
        esc_ms = close_help_esc(sess)
        metrics["esc_close_ms"] = round(esc_ms * 1000, 2)

        overlay_cases = (
            ("f2_ss3", KEY["f2_ss3"], ("Event log (F2)", "事件日志 (F2)")),
            ("f2_csi", KEY["f2_csi"], ("Event log (F2)", "事件日志 (F2)")),
            ("f3_ss3", KEY["f3_ss3"], ("Timeline (F3)", "时间线 (F3)")),
            ("f4_ss3", KEY["f4_ss3"], ("Explain (F4)", "解释 (F4)")),
        )
        for label, seq, titles in overlay_cases:
            sess.focus_input()
            time.sleep(0.05)
            sess.write(seq)
            opened = False
            deadline = time.time() + 2.5
            while time.time() < deadline:
                view = _screen_view(sess)
                if any(t in view for t in titles):
                    opened = True
                    break
                time.sleep(0.04)
            metrics[f"overlay_{label}"] = opened
            if not opened:
                raise AssertionError(f"{label} did not open overlay {titles!r}")
            sess.write(KEY["esc"])
            close_deadline = time.time() + 1.2
            while time.time() < close_deadline:
                view = _screen_view(sess)
                if not any(t in view for t in titles):
                    break
                time.sleep(0.04)
            time.sleep(0.06)

        palette_marker = os.environ.get("HOST_PTY_PALETTE_MARKER", "Command palette")
        palette_markers = (palette_marker, "命令面板", "Command palette", "palette:title", "palette.title")
        sess.focus_input()
        time.sleep(0.08)
        sess.write(KEY["ctrl_p"])
        opened = False
        deadline = time.time() + 2.5
        while time.time() < deadline:
            tail = _screen_view(sess)
            if any(m in tail for m in palette_markers):
                opened = True
                break
            time.sleep(0.05)
        if not opened:
            raise AssertionError("Ctrl+P did not open command palette")
        close_deadline = time.time() + 2.0
        while time.time() < close_deadline:
            tail = _screen_view(sess)
            if not any(m in tail for m in palette_markers):
                break
            sess.write(KEY["esc"])
            time.sleep(0.08)
        tail = _screen_view(sess)
        if any(m in tail for m in palette_markers):
            raise AssertionError("command palette did not close after Esc")
        sess.focus_input()

        for seq in (KEY["up_csi"], KEY["down_csi"], KEY["home_csi"], KEY["end_csi"], KEY["del_csi"]):
            sess.write(seq)
            time.sleep(0.02)

        sess.write(KEY["paste"])
        paste_deadline = time.time() + 3.0
        while time.time() < paste_deadline:
            if "bracketed-paste-test" in sess.plain_tail(1600):
                break
            time.sleep(0.05)
        else:
            raise AssertionError("bracketed paste text not visible in PTY output")
        sess.write(b"\x7f" * 32)
        time.sleep(0.1)

    burst = "achievements" if quick else "achievements" + "测" * 20
    t0 = time.perf_counter()
    sess.write(burst.encode("utf-8"))
    assert_draft(sess, burst, "burst")
    metrics["burst_ms"] = round((time.perf_counter() - t0) * 1000, 1)

    if not quick:
        sess.write(b"\x7f" * min(len(burst) + 8, 120))
        time.sleep(0.12)
        paced = "pacedtyping测试"
        t1 = time.perf_counter()
        for b in paced.encode("utf-8"):
            sess.write(bytes([b]))
            time.sleep(0.028)
        assert_draft(sess, paced, "paced", timeout=5.0)
        metrics["paced_ms"] = round((time.perf_counter() - t1) * 1000, 1)

    return metrics


def run_dev(quick: bool) -> dict:
    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["TUI_PTY_DRIVER"] = "1"
    sess = spawn_pty(
        ["bun", "run", str(DEV_SESSION), "--batch", "empty"],
        env=env,
        cwd=str(PKG),
    )
    try:
        if not sess.wait_text("TUI_READY", timeout=45.0):
            raise AssertionError("TUI_READY not seen (dev batch)")
        time.sleep(0.35)
        return _exercise(sess, quick)
    finally:
        sess.write(b":quit\n")
        try:
            sess.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            sess.write(b"\x03")
            sess.proc.wait(timeout=6)
        sess.close()


def run_dist(quick: bool) -> dict:
    sess, stub, _home, _cfg = spawn_host_dist(repo_root=REPO)
    try:
        ensure_free_roam_shell(sess, timeout=120.0)
        time.sleep(0.2)
        return _exercise(sess, quick)
    finally:
        try:
            if sess.proc.poll() is None:
                sess.write(b":quit\n")
                try:
                    sess.proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    sess.write(b"\x03")
                    try:
                        sess.proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        sess.proc.terminate()
                        sess.proc.wait(timeout=3)
        finally:
            sess.close()
            stub.terminate()
            try:
                stub.wait(timeout=3)
            except subprocess.TimeoutExpired:
                stub.kill()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=("dev", "dist", "both"), default="dev")
    parser.add_argument("--quick", action="store_true")
    args = parser.parse_args()
    targets = ("dev", "dist") if args.target == "both" else (args.target,)
    all_metrics: dict = {}
    for target in targets:
        metrics = run_dev(args.quick) if target == "dev" else run_dist(args.quick)
        all_metrics[target] = metrics
        sys.stderr.write(
            f"pty-input-harness ({target}{', quick' if args.quick else ''}): OK {metrics}\n"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
