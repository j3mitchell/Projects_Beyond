#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/.coverai.pid"
PORT_FILE="$SCRIPT_DIR/.coverai.port"
API_PID_FILE="$SCRIPT_DIR/.coverai.api.pid"
API_PORT_FILE="$SCRIPT_DIR/.coverai.api.port"

find_project_listener_on_port() {
  local port="$1"
  local pid
  pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN | head -n 1)"
  if [ -z "$pid" ]; then
    return 1
  fi
  local cwd_line
  cwd_line="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | rg '^n' | head -n 1)"
  if [[ "$cwd_line" == "n$SCRIPT_DIR" ]]; then
    printf '%s\n' "$pid"
    return 0
  fi
  return 1
}

if [ ! -f "$PID_FILE" ] && [ ! -f "$PORT_FILE" ] && [ ! -f "$API_PID_FILE" ] && [ ! -f "$API_PORT_FILE" ]; then
  echo "CoverAI does not appear to be running from this folder."
fi

APP_PID=""
APP_PORT=""
API_PID=""
API_PORT=""

if [ -f "$PID_FILE" ]; then
  APP_PID="$(cat "$PID_FILE")"
fi

if [ -f "$PORT_FILE" ]; then
  APP_PORT="$(cat "$PORT_FILE")"
fi
if [ -f "$API_PID_FILE" ]; then
  API_PID="$(cat "$API_PID_FILE")"
fi
if [ -f "$API_PORT_FILE" ]; then
  API_PORT="$(cat "$API_PORT_FILE")"
fi

if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
  echo "Stopping CoverAI (PID $APP_PID)..."
  kill "$APP_PID"
  sleep 1
  if kill -0 "$APP_PID" 2>/dev/null; then
    kill -9 "$APP_PID"
  fi
fi

if [ -n "$APP_PORT" ]; then
  PORT_PID="$(find_project_listener_on_port "$APP_PORT" || true)"
  if [ -n "$PORT_PID" ]; then
    echo "Stopping CoverAI on port $APP_PORT (PID $PORT_PID)..."
    kill "$PORT_PID"
    sleep 1
    if kill -0 "$PORT_PID" 2>/dev/null; then
      kill -9 "$PORT_PID"
    fi
    echo "CoverAI stopped."
  fi
fi

for candidate_port in 3000 3100 3200 3300 3400; do
  PORT_PID="$(find_project_listener_on_port "$candidate_port" || true)"
  if [ -n "$PORT_PID" ]; then
    echo "Stopping CoverAI on port $candidate_port (PID $PORT_PID)..."
    kill "$PORT_PID"
    sleep 1
    if kill -0 "$PORT_PID" 2>/dev/null; then
      kill -9 "$PORT_PID"
    fi
  fi
done

if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
  echo "Stopping CoverAI AI API (PID $API_PID)..."
  kill "$API_PID"
  sleep 1
  if kill -0 "$API_PID" 2>/dev/null; then
    kill -9 "$API_PID"
  fi
fi

if [ -n "$API_PORT" ]; then
  API_PORT_PID="$(find_project_listener_on_port "$API_PORT" || true)"
  if [ -n "$API_PORT_PID" ]; then
    echo "Stopping CoverAI AI API on port $API_PORT (PID $API_PORT_PID)..."
    kill "$API_PORT_PID"
    sleep 1
    if kill -0 "$API_PORT_PID" 2>/dev/null; then
      kill -9 "$API_PORT_PID"
    fi
  fi
fi

for candidate_port in 4000 4100 4200 4300 4400; do
  API_PORT_PID="$(find_project_listener_on_port "$candidate_port" || true)"
  if [ -n "$API_PORT_PID" ]; then
    echo "Stopping CoverAI AI API on port $candidate_port (PID $API_PORT_PID)..."
    kill "$API_PORT_PID"
    sleep 1
    if kill -0 "$API_PORT_PID" 2>/dev/null; then
      kill -9 "$API_PORT_PID"
    fi
  fi
done

rm -f "$PID_FILE" "$PORT_FILE" "$API_PID_FILE" "$API_PORT_FILE"
echo "CoverAI services stopped."
