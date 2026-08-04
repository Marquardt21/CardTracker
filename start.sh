#!/usr/bin/env bash
# CardTracker launcher for Linux/macOS. The Windows equivalent is start.ps1; the
# two are kept deliberately parallel so a change to one is easy to mirror.
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCLUB_DIR="$(cd "$PROJECT_DIR/../MClubCards" 2>/dev/null && pwd || true)"

# Python versions this project's pinned dependencies ship wheels for, best
# first. 3.14 is deliberately excluded: pydantic-core has no 3.14 wheel yet, so
# pip would fall back to compiling Rust.
SUPPORTED_PYTHON="3.13 3.12 3.11"

# Free a port without depending on fuser, which isn't installed by default on
# every distro (and doesn't exist on macOS).
kill_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${port}" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  fi
}

lan_address() {
  if hostname -I >/dev/null 2>&1; then
    hostname -I | awk '{print $1}'
  elif command -v ip >/dev/null 2>&1; then
    ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}'
  else
    echo "localhost"
  fi
}

# ── Pipeline dashboard (MClubCards) ─────────────────────────────────────────
PIPELINE_PID=""
if [ -n "$MCLUB_DIR" ] && command -v uv >/dev/null 2>&1; then
  echo "Starting pipeline dashboard (mclub gui) on port 8765…"
  (cd "$MCLUB_DIR" && uv run mclub gui --no-browser --port 8765) &
  PIPELINE_PID=$!
  echo "Pipeline PID: $PIPELINE_PID"
else
  echo "Skipping pipeline dashboard — MClubCards not found next to this repo, or uv is not installed."
fi

# ── Backend ──────────────────────────────────────────────────────────────────
echo "Starting backend (FastAPI) on port 8000…"
cd "$PROJECT_DIR"

if [ ! -x ".venv/bin/python" ]; then
  # A .venv without a working interpreter is one created on Windows (it has
  # Scripts/ instead of bin/) or one left half-built by an interrupted run.
  if [ -d ".venv" ]; then
    echo "Removing an unusable .venv (created by a different OS, or interrupted)…"
    rm -rf .venv
  fi

  PY=""
  for v in $SUPPORTED_PYTHON; do
    if command -v "python$v" >/dev/null 2>&1; then PY="python$v"; break; fi
  done
  if [ -z "$PY" ]; then
    echo "ERROR: none of these Python versions are installed: $SUPPORTED_PYTHON" >&2
    echo "       Python 3.14 will not work — pydantic has no 3.14 wheel, so pip" >&2
    echo "       would try to compile Rust from source." >&2
    exit 1
  fi

  echo "Creating Python virtual environment ($PY)…"
  "$PY" -m venv .venv
fi

# Call the venv's interpreter directly rather than sourcing activate — it behaves
# the same whether or not this script is run from an already-activated shell.
VENV_PY="$PROJECT_DIR/.venv/bin/python"
"$VENV_PY" -m pip install -q --disable-pip-version-check -r requirements.txt

mkdir -p data photos

kill_port 8000

"$VENV_PY" -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# ── Frontend ─────────────────────────────────────────────────────────────────
echo "Starting frontend (Vite) on port 3000…"
cd "$PROJECT_DIR/frontend"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Node.js / npm is not installed. Install Node 18 or newer and re-run." >&2
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies…"
  npm install
fi

kill_port 3000

npm run dev &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " CardTracker is running!"
echo " Open on this machine : http://localhost:3000"
echo " Open from iPad / phone: http://$(lan_address):3000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Press Ctrl+C to stop both servers."
echo ""

# Wait for either process to exit, then kill both
trap "echo 'Shutting down…'; kill $BACKEND_PID $FRONTEND_PID $PIPELINE_PID 2>/dev/null; exit" INT TERM
wait $BACKEND_PID $FRONTEND_PID
