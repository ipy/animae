#!/bin/sh
# Local venv with pyte for PTY terminal emulation (PEP 668 safe).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/.venv-pty"
if [ ! -x "$VENV/bin/python3" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -U pip
  "$VENV/bin/pip" install -q pyte
fi
exec "$VENV/bin/python3" "$@"
