#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/.coverai.pid"
PORT_FILE="$SCRIPT_DIR/.coverai.port"
LOG_FILE="$SCRIPT_DIR/.coverai.log"
API_PID_FILE="$SCRIPT_DIR/.coverai.api.pid"
API_PORT_FILE="$SCRIPT_DIR/.coverai.api.port"
API_LOG_FILE="$SCRIPT_DIR/.coverai.api.log"

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

cd "$SCRIPT_DIR"

if [ ! -d "node_modules" ]; then
  echo "Installing CoverAI dependencies..."
  npm install
fi

echo "Resetting existing CoverAI services..."
"$SCRIPT_DIR/stop-coverai.command" >/dev/null 2>&1 || true

echo "Starting CoverAI..."
echo "Writing startup logs to $LOG_FILE"

if [ -f "$LOG_FILE" ]; then
  rm -f "$LOG_FILE"
fi
if [ -f "$API_LOG_FILE" ]; then
  rm -f "$API_LOG_FILE"
fi

PORT=3000
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  PORT=$((PORT + 100))
fi

API_PORT=4000
if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  API_PORT=$((API_PORT + 100))
fi

echo "$PORT" > "$PORT_FILE"
echo "$API_PORT" > "$API_PORT_FILE"

AI_API_HOST=127.0.0.1 AI_API_PORT="$API_PORT" nohup npm run api >"$API_LOG_FILE" 2>&1 &
API_PID=$!
echo "$API_PID" > "$API_PID_FILE"

HOST=127.0.0.1 PORT="$PORT" REACT_APP_AI_API_BASE="http://127.0.0.1:$API_PORT" BROWSER=none nohup npm start >"$LOG_FILE" 2>&1 &
APP_PID=$!
echo "$APP_PID" > "$PID_FILE"

API_READY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1; then
    API_READY=1
    break
  fi
  sleep 1
done

READY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if ! kill -0 "$API_PID" 2>/dev/null; then
  echo "CoverAI AI API exited during startup."
  echo "Check $API_LOG_FILE for details."
  rm -f "$API_PID_FILE" "$API_PORT_FILE"
  exit 1
fi

if ! kill -0 "$APP_PID" 2>/dev/null; then
  echo "CoverAI exited during startup."
  echo "Check $LOG_FILE for details."
  rm -f "$PID_FILE" "$PORT_FILE"
  exit 1
fi

REAL_API_PID="$(find_project_listener_on_port "$API_PORT" || true)"
if [ -n "$REAL_API_PID" ]; then
  echo "$REAL_API_PID" > "$API_PID_FILE"
fi

REAL_APP_PID="$(find_project_listener_on_port "$PORT" || true)"
if [ -n "$REAL_APP_PID" ]; then
  echo "$REAL_APP_PID" > "$PID_FILE"
fi

if [ "$READY" -eq 1 ]; then
  echo "CoverAI is running at http://127.0.0.1:$PORT"
  if [ "$API_READY" -eq 1 ]; then
    echo "CoverAI AI API is running at http://127.0.0.1:$API_PORT"
  else
    echo "CoverAI AI API is still warming up at http://127.0.0.1:$API_PORT"
  fi
  if [ "${COVERAI_SKIP_OPEN:-0}" != "1" ]; then
    open "http://127.0.0.1:$PORT"
  fi
else
  echo "CoverAI started, but the page is not responding yet."
  echo "You can check $LOG_FILE and then open http://127.0.0.1:$PORT manually."
fi
