#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Backend ──────────────────────────────────────────────────────────────────
echo "Starting backend (FastAPI) on port 8000…"
cd "$PROJECT_DIR"

if [ ! -d ".venv" ]; then
  echo "Creating Python virtual environment…"
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

mkdir -p data photos

# Kill any existing backend on port 8000
fuser -k 8000/tcp 2>/dev/null || true

uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# ── Frontend ─────────────────────────────────────────────────────────────────
echo "Starting frontend (Vite) on port 3000…"
cd "$PROJECT_DIR/frontend"

if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies…"
  npm install
fi

# Kill any existing frontend on port 3000
fuser -k 3000/tcp 2>/dev/null || true

npm run dev &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " CardTracker is running!"
echo " Open on this machine : http://localhost:3000"
echo " Open from iPad / phone: http://$(hostname -I | awk '{print $1}'):3000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Press Ctrl+C to stop both servers."
echo ""

# Wait for either process to exit, then kill both
trap "echo 'Shutting down…'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait $BACKEND_PID $FRONTEND_PID
