#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

ROOT="$(pwd)"
LAUNCHER="${ROOT}/start_mod_checklist_server_forever.command"
LABEL="com.mod-check-list.server"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${ROOT}/logs"

chmod +x "${LAUNCHER}"
mkdir -p "${HOME}/Library/LaunchAgents" "${LOG_DIR}"

cat > "${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${LAUNCHER}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launchd.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "${PLIST}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST}"
launchctl enable "gui/$(id -u)/${LABEL}"

echo "macOS autostart installed."
echo "The app will start after login and is available at http://localhost:4000"
echo "To stop autostart later:"
echo "launchctl bootout gui/$(id -u) ${PLIST}"
