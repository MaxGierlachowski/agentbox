#!/usr/bin/env bash
# Re-records the whole setup video: a brand-new box container, the public one-liner, the real
# onboarding in the browser, then the stitched full and short cuts.
#
#   e2e/video/record.sh [install-url] [final-dir]
# Needs: docker (arm64 or x64 host), asciinema >= 3, agg, ffmpeg, bun, Playwright's Chromium.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
URL="${1:-https://maxgierlachowski.github.io/agentbox/install.sh}"
FINAL="${2:-$HERE/out}"
export PORT="${PORT:-38443}"

"$HERE/record-terminal.sh" "$URL"
cd "$HERE/.."
BOX="https://127.0.0.1:$PORT" OTP="$(cat "$HERE/out/otp.txt")" bun video/record-browser.ts
bun video/stitch.ts "$FINAL"
echo "done → $FINAL"
