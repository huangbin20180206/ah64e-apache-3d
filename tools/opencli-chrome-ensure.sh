#!/usr/bin/env bash
# Ensure Windows Chrome is running and OpenCLI Browser Bridge is connected.
# Usage: tools/opencli-chrome-ensure.sh [wait_seconds]
# Exit 0 + "READY" when a connected profile exists; exit 1 + reason otherwise.
set -u
WAIT="${1:-60}"
profiles_connected() {
  opencli profile list 2>/dev/null | grep -qiE "connected"
}
if profiles_connected; then echo "READY: bridge profile already connected"; exit 0; fi
if ! tasklist.exe /FI "IMAGENAME eq chrome.exe" /FO TABLE /NH 2>/dev/null | grep -qi "chrome.exe"; then
  echo "Chrome not running on Windows — starting it..."
  cmd.exe /c start "" chrome >/dev/null 2>&1
  sleep 5
else
  echo "Chrome is running but bridge not connected — waiting for extension..."
fi
for ((i=0; i<WAIT; i+=3)); do
  if profiles_connected; then echo "READY: bridge connected"; exit 0; fi
  sleep 3
done
echo "NOT_READY: no connected bridge profile after ${WAIT}s" >&2
echo "Check: 1) Chrome extension enabled 2) opencli doctor 3) opencli daemon restart" >&2
exit 1
