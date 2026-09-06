#!/bin/bash

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/ResumeATS-autopull.log"
STATE_DIR="$HOME/Library/Application Support/ResumeATS"
STATE_FILE="$STATE_DIR/last-applied-sha"
CHECK_SECONDS=10
mkdir -p "$LOG_DIR" "$STATE_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

repo_changes() {
  git status --porcelain 2>/dev/null | grep -vE '^\?\? frontend/package-lock\.json$' || true
}

apply_current_head_if_needed() {
  cd "$REPO_DIR" || return 0

  CURRENT="$(git rev-parse HEAD 2>/dev/null || true)"
  [ -z "$CURRENT" ] && return 0

  APPLIED=""
  [ -f "$STATE_FILE" ] && APPLIED="$(cat "$STATE_FILE" 2>/dev/null || true)"

  if [ "$CURRENT" = "$APPLIED" ]; then
    return 0
  fi

  if RESUMEATS_SKIP_OPEN=1 "$REPO_DIR/start-resumeats.command" >> "$LOG_FILE" 2>&1; then
    printf '%s\n' "$CURRENT" > "$STATE_FILE"
    log "Applied ResumeATS revision $CURRENT and restarted app."
  else
    log "Revision $CURRENT is present, but app restart failed; will retry automatically."
  fi
}

sync_once() {
  cd "$REPO_DIR" || return 0

  [ -d .git ] || return 0

  BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  if [ "$BRANCH" != "main" ]; then
    log "Sync paused: current branch is '$BRANCH', expected 'main'."
    return 0
  fi

  if ! git fetch --quiet origin main; then
    log "Sync fetch failed."
    return 0
  fi

  LOCAL="$(git rev-parse HEAD 2>/dev/null || true)"
  REMOTE="$(git rev-parse origin/main 2>/dev/null || true)"
  BASE="$(git merge-base HEAD origin/main 2>/dev/null || true)"

  if [ -n "$LOCAL" ] && [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
    if [ "$LOCAL" = "$BASE" ]; then
      # Do not blanket-block on a dirty tree. Git itself safely refuses a
      # fast-forward only when a local edit would actually be overwritten.
      # Harmless local changes can coexist with remote updates.
      MERGE_OUTPUT="$(git merge --ff-only origin/main 2>&1)"
      MERGE_STATUS=$?
      if [ "$MERGE_STATUS" -eq 0 ]; then
        log "Updated ResumeATS to $REMOTE."
        apply_current_head_if_needed
        return 10
      fi

      CHANGES="$(repo_changes | tr '\n' '; ')"
      log "Sync blocked by local changes that overlap the update. ${CHANGES:-No status details.} Git: $MERGE_OUTPUT"
      return 0
    fi

    CHANGES="$(repo_changes | tr '\n' '; ')"
    log "Sync paused: local main diverged from origin/main. ${CHANGES:-Working tree clean.}"
    return 0
  fi

  apply_current_head_if_needed
  return 0
}

while true; do
  sync_once
  STATUS=$?
  if [ "$STATUS" -eq 10 ]; then
    exit 0
  fi
  sleep "$CHECK_SECONDS"
done
