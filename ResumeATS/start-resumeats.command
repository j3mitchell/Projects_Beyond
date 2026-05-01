#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
APP_PID_FILE="$SCRIPT_DIR/.resumeats.pid"
APP_PORT_FILE="$SCRIPT_DIR/.resumeats.port"
APP_LOG_FILE="$SCRIPT_DIR/.resumeats.log"
API_PID_FILE="$SCRIPT_DIR/.resumeats.api.pid"
API_PORT_FILE="$SCRIPT_DIR/.resumeats.api.port"
API_LOG_FILE="$SCRIPT_DIR/.resumeats.api.log"

cd "$SCRIPT_DIR"

"$SCRIPT_DIR/stop-resumeats.command" >/dev/null 2>&1 || true

if [ ! -d "$BACKEND_DIR/.venv" ]; then
  echo "Creating ResumeATS backend virtualenv..."
  python3 -m venv "$BACKEND_DIR/.venv"
fi

if [ ! -x "$BACKEND_DIR/.venv/bin/python" ]; then
  echo "ResumeATS backend virtualenv is invalid."
  exit 1
fi

echo "Installing ResumeATS backend dependencies..."
"$BACKEND_DIR/.venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt" >/dev/null

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Installing ResumeATS frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
fi

APP_PORT=3000
if lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  APP_PORT=3200
fi

API_PORT=8000
if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  API_PORT=8100
fi

echo "$APP_PORT" > "$APP_PORT_FILE"
echo "$API_PORT" > "$API_PORT_FILE"
rm -f "$APP_LOG_FILE" "$API_LOG_FILE"

(
  cd "$BACKEND_DIR"
  nohup "$BACKEND_DIR/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" >"$API_LOG_FILE" 2>&1 &
  echo $! > "$API_PID_FILE"
)

(
  cd "$FRONTEND_DIR"
  HOST=127.0.0.1 PORT="$APP_PORT" REACT_APP_API_BASE="http://127.0.0.1:$API_PORT" BROWSER=none nohup npm start >"$APP_LOG_FILE" 2>&1 &
  echo $! > "$APP_PID_FILE"
)

API_READY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then
    API_READY=1
    break
  fi
  sleep 1
done

APP_READY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$APP_PORT" >/dev/null 2>&1; then
    APP_READY=1
    break
  fi
  sleep 1
done

if [ "$API_READY" -ne 1 ]; then
  echo "ResumeATS backend did not become ready."
  echo "Check $API_LOG_FILE"
  exit 1
fi

if [ "$APP_READY" -ne 1 ]; then
  echo "ResumeATS frontend did not become ready."
  echo "Check $APP_LOG_FILE"
  exit 1
fi

echo "ResumeATS is running at http://127.0.0.1:$APP_PORT"
echo "ResumeATS API is running at http://127.0.0.1:$API_PORT"

if [ "${RESUMEATS_SKIP_OPEN:-0}" != "1" ]; then
  open "http://127.0.0.1:$APP_PORT"
fi
