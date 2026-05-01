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

stop_port() {
  local port="$1"
  if [ -z "$port" ]; then
    return
  fi
  local pid
  pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN | head -n 1)"
  stop_pid "$pid"
}

APP_PID=""
API_PID=""
APP_PORT=""
API_PORT=""

[ -f "$APP_PID_FILE" ] && APP_PID="$(cat "$APP_PID_FILE")"
[ -f "$API_PID_FILE" ] && API_PID="$(cat "$API_PID_FILE")"
[ -f "$APP_PORT_FILE" ] && APP_PORT="$(cat "$APP_PORT_FILE")"
[ -f "$API_PORT_FILE" ] && API_PORT="$(cat "$API_PORT_FILE")"

stop_pid "$APP_PID"
stop_pid "$API_PID"
stop_port "$APP_PORT"
stop_port "$API_PORT"

rm -f "$APP_PID_FILE" "$APP_PORT_FILE" "$API_PID_FILE" "$API_PORT_FILE"
echo "ResumeATS services stopped."
