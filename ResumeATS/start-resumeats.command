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
REQ_STAMP="$BACKEND_DIR/.requirements.sha256"

cd "$SCRIPT_DIR"

# Prepare the new revision BEFORE stopping a currently healthy instance.
# This makes updates transactional: a dependency/preflight failure cannot take
# the existing ResumeATS instance offline.
if [ ! -d "$BACKEND_DIR/.venv" ]; then
  echo "Creating ResumeATS backend virtualenv..."
  python3 -m venv "$BACKEND_DIR/.venv"
fi

if [ ! -x "$BACKEND_DIR/.venv/bin/python" ]; then
  echo "ResumeATS backend virtualenv is invalid."
  exit 1
fi

REQ_HASH="$(shasum -a 256 "$BACKEND_DIR/requirements.txt" | awk '{print $1}')"
INSTALLED_HASH=""
[ -f "$REQ_STAMP" ] && INSTALLED_HASH="$(cat "$REQ_STAMP" 2>/dev/null || true)"

if [ "$REQ_HASH" != "$INSTALLED_HASH" ]; then
  echo "Updating ResumeATS backend dependencies..."
  if "$BACKEND_DIR/.venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt" >/dev/null; then
    printf '%s\n' "$REQ_HASH" > "$REQ_STAMP"
  else
    echo "Dependency update had an error; checking whether core ResumeATS can still run..."
  fi
fi

# Core runtime must exist. PDF support is optional at startup and is loaded lazily.
if ! "$BACKEND_DIR/.venv/bin/python" -c "import fastapi, uvicorn, docx, striprtf, reportlab, spacy" >/dev/null 2>&1; then
  echo "ResumeATS core backend dependencies are unavailable. Existing instance was left untouched."
  exit 1
fi

# Use spaCy's small English NER model when available. Model download failure is
# non-fatal because the classifier has a tokenizer/O*NET fallback.
if ! "$BACKEND_DIR/.venv/bin/python" -c "import spacy; spacy.load('en_core_web_sm')" >/dev/null 2>&1; then
  echo "Installing spaCy English model..."
  "$BACKEND_DIR/.venv/bin/python" -m spacy download en_core_web_sm >/dev/null 2>&1 || \
    echo "spaCy English model unavailable; using tokenizer/O*NET fallback."
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ] || [ ! -d "$FRONTEND_DIR/node_modules/zod" ]; then
  echo "Installing ResumeATS frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install --no-package-lock)
fi

# Compile/import preflight before touching the running app.
if ! (
  cd "$BACKEND_DIR" &&
  "$BACKEND_DIR/.venv/bin/python" -m py_compile app/api.py app/parser_pipeline.py app/resume_io.py app/classifier.py app/contracts.py &&
  "$BACKEND_DIR/.venv/bin/python" -c "import app.api"
); then
  echo "ResumeATS backend preflight failed. Existing instance was left untouched."
  exit 1
fi

# New revision is ready; now replace the running instance.
"$SCRIPT_DIR/stop-resumeats.command" >/dev/null 2>&1 || true

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
  nohup "$BACKEND_DIR/.venv/bin/python" -m uvicorn app.api:app --host 127.0.0.1 --port "$API_PORT" --reload --reload-dir "$BACKEND_DIR/app" >"$API_LOG_FILE" 2>&1 &
  echo $! > "$API_PID_FILE"
)

(
  cd "$FRONTEND_DIR"
  HOST=127.0.0.1 PORT="$APP_PORT" REACT_APP_API_BASE="http://127.0.0.1:$API_PORT" BROWSER=none nohup npm start >"$APP_LOG_FILE" 2>&1 &
  echo $! > "$APP_PID_FILE"
)

API_READY=0
API_HEALTH=""
for _ in $(seq 1 45); do
  if API_HEALTH="$(curl -fsS "http://127.0.0.1:$API_PORT/health" 2>/dev/null)"; then
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
echo "ResumeATS API health: $API_HEALTH"
echo "Frontend and backend hot reload are enabled."

if [ "${RESUMEATS_SKIP_OPEN:-0}" != "1" ]; then
  open "http://127.0.0.1:$APP_PORT"
fi
