#!/usr/bin/env bash
set -euo pipefail

LABEL="com.mod-check-list.server"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)" "${PLIST}" >/dev/null 2>&1 || true
rm -f "${PLIST}"

echo "macOS autostart removed."
