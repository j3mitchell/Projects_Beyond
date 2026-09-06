#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTO_SCRIPT="$SCRIPT_DIR/scripts/auto-pull.sh"
LABEL="net.jisystems.resumeats-autopull"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
STDOUT_LOG="$LOG_DIR/ResumeATS-autopull-launchd.log"
STDERR_LOG="$LOG_DIR/ResumeATS-autopull-launchd-error.log"

mkdir -p "$PLIST_DIR" "$LOG_DIR"
chmod +x "$AUTO_SCRIPT"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$AUTO_SCRIPT</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$SCRIPT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>2</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$STDOUT_LOG</string>
  <key>StandardErrorPath</key>
  <string>$STDERR_LOG</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl enable "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$UID/$LABEL" >/dev/null 2>&1 || true

echo "ResumeATS continuous GitHub sync installed."
echo "GitHub is checked every 10 seconds and each new main commit is pulled automatically."
echo "Local edits are protected: sync pauses whenever the working tree is not clean."
echo "Log: $HOME/Library/Logs/ResumeATS-autopull.log"
