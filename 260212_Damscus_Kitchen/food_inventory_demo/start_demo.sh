#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$ROOT_DIR/.venv"
RUN_DIR="$ROOT_DIR/.run"

mkdir -p "$RUN_DIR"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

stop_pid_file_if_running() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
    fi
    rm -f "$pid_file"
  fi
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local attempts=45
  local sleep_seconds=1

  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name is reachable: $url"
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "Timed out waiting for $name at $url"
  return 1
}

require_cmd python3
require_cmd npm
require_cmd curl

cd "$ROOT_DIR"

if [[ ! -d "$VENV_DIR" ]]; then
  echo "Creating Python virtual environment..."
  python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"

echo "Installing/updating backend Python dependencies..."
pip install -q -r "$BACKEND_DIR/requirements.txt"

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Installing frontend npm dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
fi

stop_pid_file_if_running "$RUN_DIR/backend.pid"
stop_pid_file_if_running "$RUN_DIR/frontend.pid"

echo "Starting backend (FastAPI on 127.0.0.1:8000)..."
nohup "$VENV_DIR/bin/python" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 >"$RUN_DIR/backend.log" 2>&1 &
echo $! > "$RUN_DIR/backend.pid"

wait_for_http "http://127.0.0.1:8000/" "Backend"

echo "Starting frontend (React on localhost:4000)..."
nohup npm --prefix "$FRONTEND_DIR" start >"$RUN_DIR/frontend.log" 2>&1 &
echo $! > "$RUN_DIR/frontend.pid"

wait_for_http "http://localhost:4000/" "Frontend"

echo "Running quick API checks..."
curl -fsS "http://127.0.0.1:8000/reports/dashboard" >/dev/null
echo "API checks passed."

echo "Opening browser..."
open "http://localhost:4000/"

echo
echo "Demo app started successfully."
echo "Frontend: http://localhost:4000/"
echo "Backend docs: http://127.0.0.1:8000/docs#/default/read_meals_meals__get"
echo "Logs: $RUN_DIR/backend.log and $RUN_DIR/frontend.log"
