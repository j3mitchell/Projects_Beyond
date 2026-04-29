#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT_DIR/.run"

stop_pid_file_if_running() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
      if kill -0 "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
    fi
    rm -f "$pid_file"
  fi
}

stop_port_if_in_use() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi
  local pids
  pids="$(lsof -ti tcp:"$port" || true)"
  if [[ -z "$pids" ]]; then
    return
  fi
  for pid in $pids; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  sleep 1
  pids="$(lsof -ti tcp:"$port" || true)"
  if [[ -n "$pids" ]]; then
    for pid in $pids; do
      kill -9 "$pid" >/dev/null 2>&1 || true
    done
  fi
}

stop_pid_file_if_running "$RUN_DIR/backend.pid"
stop_pid_file_if_running "$RUN_DIR/frontend.pid"
stop_port_if_in_use 8000
stop_port_if_in_use 4000

echo "Stopped demo services (if they were running)."
