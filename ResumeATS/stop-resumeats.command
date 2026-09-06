#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PID_FILE="$SCRIPT_DIR/.resumeats.pid"
APP_PORT_FILE="$SCRIPT_DIR/.resumeats.port"
API_PID_FILE="$SCRIPT_DIR/.resumeats.api.pid"
API_PORT_FILE="$SCRIPT_DIR/.resumeats.api.port"

stop_pid() {
  local pid="$1"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
}

is_resumeats_pid() {
  local pid="$1"
  [ -z "$pid" ] && return 1
  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$command" in
    *"$SCRIPT_DIR"*) return 0 ;;
    *) return 1 ;;
  esac
}

stop_port_if_resumeats() {
  local port="$1"
  local pid
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    if is_resumeats_pid "$pid"; then
      stop_pid "$pid"
    fi
  done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
}

APP_PID=""
API_PID=""
APP_PORT=""
API_PORT=""

[ -f "$APP_PID_FILE" ] && APP_PID="$(cat "$APP_PID_FILE")"
[ -f "$API_PID_FILE" ] && API_PID="$(cat "$API_PID_FILE")"
[ -f "$APP_PORT_FILE" ] && APP_PORT="$(cat "$APP_PORT_FILE")"
[ -f "$API_PORT_FILE" ] && API_PORT="$(cat "$API_PORT_FILE")"

# Stop processes recorded by the current launcher.
stop_pid "$APP_PID"
stop_pid "$API_PID"

# Also clean up orphaned ResumeATS listeners from older launches. This is
# intentionally limited to ResumeATS-owned processes so unrelated dev apps
# using the same ports are never killed.
for port in 3000 3200 8000 8100; do
  stop_port_if_resumeats "$port"
done

rm -f "$APP_PID_FILE" "$APP_PORT_FILE" "$API_PID_FILE" "$API_PORT_FILE"
echo "ResumeATS services stopped."
