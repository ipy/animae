#!/usr/bin/env python3
"""
Rigorous PTY suite against compiled host binary (pyte screen + background reader).

Metrics JSON on stderr. Quick: CI/build gate. Full: stress + flow + resize.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import statistics
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
PKG = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PKG / "scripts"))
from pty_lib import PtySession, spawn_host_dist, wait_host_main_ui  # noqa: E402

# Terminal key bytes (xterm / Terminal.app / iTerm2 / tmux / kitty legacy)
KEY = {
    "f1_ss3": b"\x1bOP",
    "f1_csi": b"\x1b[11~",
    "f1_mod": b"\x1b[1;2P",
    "f2_ss3": b"\x1bOQ",
    "f3_ss3": b"\x1bOR",
    "f4_ss3": b"\x1bOS",
    "f5_csi": b"\x1b[15~",
    "esc": b"\x1b",
    "up_csi": b"\x1b[A",
    "up_ss3": b"\x1bOA",
    "home_csi": b"\x1b[H",
    "home_rxvt": b"\x1b[7~",
    "ctrl_p": b"\x10",
    "alt_1": b"\x1b1",
}


def _screen_view(sess: PtySession) -> str:
    lines = sess.screen_lines()
    if lines:
        return "\n".join(lines)
    return sess.plain_tail(2800)


def overlay_open(sess: PtySession, title: str, timeout: float = 2.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if title in _screen_view(sess):
            return True
        time.sleep(0.04)
    return title in _screen_view(sess)


def close_overlay_esc(sess: PtySession, title: str, budget_s: float = 0.35) -> float | None:
    t0 = time.perf_counter()
    sess.write(KEY["esc"])
    deadline = t0 + budget_s
    while time.perf_counter() < deadline:
        if title not in _screen_view(sess):
            return time.perf_counter() - t0
        time.sleep(0.008)
    sess.write(KEY["esc"])
    deadline = t0 + budget_s + 0.25
    while time.perf_counter() < deadline:
        if title not in _screen_view(sess):
            return time.perf_counter() - t0
        time.sleep(0.008)
    return None


def measure_typing(sess: PtySession, text: str, *, gap: float = 0, burst: bool = False) -> float:
    start = time.perf_counter()
    if burst or gap <= 0:
        sess.write(text.encode("utf-8"))
    else:
        for b in text.encode("utf-8"):
            sess.write(bytes([b]))
            time.sleep(gap)
    deadline = start + max(3.0, len(text) * 0.06 + 1.5)
    while time.perf_counter() < deadline:
        if sess.draft_matches(text):
            return time.perf_counter() - start
        time.sleep(0.02)
    return time.perf_counter() - start


def per_keystroke_latencies(sess: PtySession, text: str, rng: random.Random) -> list[float]:
    """stdin write → pyte input line shows expected prefix (ms)."""
    lat: list[float] = []
    expected = ""
    for ch in text:
        expected += ch
        t0 = time.perf_counter()
        sess.write(ch.encode("utf-8"))
        if rng.random() < 0.2:
            time.sleep(rng.uniform(0, 0.012))
        deadline = t0 + 0.5
        while time.perf_counter() < deadline:
            if sess.draft_matches(expected):
                lat.append(time.perf_counter() - t0)
                break
            time.sleep(0.004)
        else:
            lat.append(time.perf_counter() - t0)
    return lat


def stress_random(sess: PtySession, runs: int, rng: random.Random) -> dict:
    latencies: list[float] = []
    drops = 0
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    cjk = "测文你好世界"
    for i in range(runs):
        n = rng.randint(4, 48)
        if rng.random() < 0.25:
            expected = "".join(rng.choice(cjk) for _ in range(min(n, 20)))
        else:
            expected = "".join(rng.choice(alphabet) for _ in range(n))
        if rng.random() < 0.35:
            payload = expected.encode("utf-8")
            if rng.random() < 0.5 and len(payload) > 1:
                split = rng.randint(1, len(payload) - 1)
                sess.write(payload[:split])
                time.sleep(rng.uniform(0, 0.02))
                sess.write(payload[split:])
            else:
                sess.write(payload)
        else:
            for b in expected.encode("utf-8"):
                sess.write(bytes([b]))
                time.sleep(rng.uniform(0, 0.04))
        t0 = time.perf_counter()
        ok = False
        while time.perf_counter() - t0 < 2.8:
            if sess.draft_matches(expected):
                ok = True
                break
            time.sleep(0.012)
        latencies.append(time.perf_counter() - t0)
        if not ok:
            drops += 1
        sess.write(b"\x7f" * min(len(expected) + 6, 160))
        time.sleep(0.05)
    latencies.sort()
    p50 = latencies[len(latencies) // 2] if latencies else 0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
    return {
        "runs": runs,
        "drops": drops,
        "latency_p50_ms": round(p50 * 1000, 1),
        "latency_p95_ms": round(p95 * 1000, 1),
        "latency_max_ms": round(max(latencies) * 1000, 1) if latencies else 0,
    }


def user_flow(sess: PtySession) -> list[str]:
    errs: list[str] = []
    turn_line = os.environ.get("HOST_PTY_TURN_LINE", "hello\n")
    sess.write(turn_line.encode("utf-8"))
    turn_ok = os.environ.get("HOST_PTY_TURN_MARKER", "")
    if turn_ok and not sess.wait_text(turn_ok, timeout=45.0):
        if not sess.wait_text(":", timeout=2.0):
            errs.append("turn did not return dialogue")
    try:
        sess.focus_input()
    except RuntimeError as exc:
        errs.append(str(exc))
    sess.write(b":help\n")
    time.sleep(0.15)
    sess.write(b":achievements\n")
    time.sleep(0.4)
    ach_marker = os.environ.get("HOST_PTY_ACH_MARKER", "achievement")
    if ach_marker not in sess.plain_tail(4000).lower():
        errs.append(":achievements produced no visible output")
    for cmd in (b":save\n", b":name\n"):
        sess.write(cmd)
        time.sleep(0.2)
    sess.write(b":quit\n")
    return errs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true")
    args = parser.parse_args()
    sess, stub, _h, _c = spawn_host_dist(repo_root=REPO)
    metrics: dict = {"target": "host-dist", "pyte": sess.screen is not None}
    try:
        wait_host_main_ui(sess, timeout=120.0)
        time.sleep(0.3)
        sess.write(b":leave\n")
        time.sleep(0.55)
        try:
            sess.focus_input()
        except RuntimeError:
            pass

        turn_line = os.environ.get("HOST_PTY_TURN_LINE", "")
        if turn_line.strip() and not args.quick:
            sess.write(turn_line.encode("utf-8"))
            marker = os.environ.get("HOST_PTY_TURN_MARKER", "")
            if marker:
                sess.wait_text(marker, timeout=45.0)
            time.sleep(0.2)
            sess.focus_input()

        metrics["burst_achievements_ms"] = round(
            measure_typing(sess, "achievements", burst=True) * 1000, 1
        )
        sess.write(b"\x7f" * 48)
        time.sleep(0.12)

        mix = ("a" * 40 + "测" * 40) if args.quick else ("a测" * 60)[:120]
        metrics["paced_mix_ms"] = round(measure_typing(sess, mix, gap=0.022) * 1000, 1)
        metrics["paced_mix_ok"] = sess.draft_matches(mix)
        sess.write(b"\x7f" * 200)
        time.sleep(0.2)

        pk = per_keystroke_latencies(sess, "achievements"[:12], random.Random(7))
        if pk:
            pk.sort()
            metrics["per_key_ms"] = {
                "p50": round(pk[len(pk) // 2] * 1000, 1),
                "p95": round(pk[int(len(pk) * 0.95)] * 1000, 1),
                "max": round(max(pk) * 1000, 1),
            }
        sess.write(b"\x7f" * 24)
        time.sleep(0.1)

        esc_lat: list[float] = []
        for seq in (KEY["f1_ss3"], KEY["f1_csi"], KEY["f1_mod"]):
            sess.write(seq)
            if overlay_open(sess, "Help (F1)"):
                dt = close_overlay_esc(sess, "Help (F1)", budget_s=0.35)
                if dt is not None:
                    esc_lat.append(dt)
                break
        metrics["esc_close_ms"] = round(statistics.median(esc_lat) * 1000, 2) if esc_lat else None
        if esc_lat and esc_lat[0] > 0.05:
            metrics["esc_close_warn"] = "exceeded 50ms target"

        sess.focus_input()
        if args.quick:
            for _ in range(2):
                sess.write(KEY["esc"])
                time.sleep(0.03)
            sess.write(b"z")
            probe = "z"
        else:
            for _ in range(5):
                sess.write(KEY["esc"])
                time.sleep(0.03)
            try:
                sess.focus_input()
            except RuntimeError:
                pass
            sess.write(b"zzzz")
            probe = "zzzz"
        deadline = time.time() + 2.5
        ok = False
        while time.time() < deadline:
            if sess.draft_matches(probe) or probe in sess.plain_tail(800):
                ok = True
                break
            time.sleep(0.04)
        if not ok:
            raise AssertionError("input dead after esc spam")

        sess.write(b"\x7f" * 8)
        sess.write(KEY["ctrl_p"])
        palette_markers = (
            os.environ.get("HOST_PTY_PALETTE_MARKER", "Command palette"),
            "Command palette",
            "命令面板",
        )
        opened = False
        deadline = time.time() + 2.5
        while time.time() < deadline:
            view = _screen_view(sess)
            if any(m in view for m in palette_markers):
                opened = True
                break
            time.sleep(0.05)
        metrics["palette_ok"] = opened
        if opened:
            sess.write(KEY["esc"])
            time.sleep(0.15)

        if not args.quick:
            sess.resize(79, 23)
            time.sleep(0.35)
            sess.write(b"resize79\n")
            if not sess.wait_text("resize79", timeout=3.0):
                metrics["resize_small_ok"] = False
            else:
                metrics["resize_small_ok"] = True
            sess.resize(120, 40)
            time.sleep(0.25)

        runs = 30 if args.quick else 200
        metrics["stress"] = stress_random(sess, runs, random.Random(42))

        if not args.quick:
            flow_errs = user_flow(sess)
            metrics["user_flow_errors"] = flow_errs
            if flow_errs:
                raise AssertionError("; ".join(flow_errs))
        else:
            sess.write(b":quit\n")
            try:
                sess.proc.wait(timeout=10)
            except Exception:
                sess.write(b"\x03")
                sess.proc.wait(timeout=6)
    finally:
        raw = sess.buf.decode("utf-8", errors="replace")
        metrics["terminal_restore"] = {
            "alt_left": "\x1b[?1049l" in raw or "\x1b[?47l" in raw,
            "cursor_show": "\x1b[?25h" in raw,
            "mouse_off": "\x1b[?1000l" in raw,
        }
        sess.close()
        stub.terminate()

    sys.stderr.write(json.dumps(metrics, indent=2) + "\n")
    stress = metrics["stress"]
    if stress["drops"] > 0:
        return 1
    if metrics.get("paced_mix_ok") is False:
        return 1
    if metrics.get("esc_close_ms") is None:
        return 1
    if stress.get("latency_p95_ms", 999) > 40:
        metrics["latency_p95_warn"] = "exceeded 40ms target (large transcript / CI host)"
    pk = metrics.get("per_key_ms")
    if pk and pk.get("p95", 0) > 40:
        metrics["per_key_p95_warn"] = "exceeded 40ms target"
    sys.stderr.write("pty_tui_rigor: OK\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
