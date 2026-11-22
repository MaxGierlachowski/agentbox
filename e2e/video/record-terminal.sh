#!/usr/bin/env bash
# Records the terminal part of the setup video: a brand-new box container, the public one-liner
# typed and run for real (asciinema, headless), then a ×8 time-lapse of the waits.
#
#   e2e/video/record-terminal.sh [install-url]
# Env: CONTAINER (default agentbox-video), PORT (LAN listener on the host, default 38443), OUT.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
URL="${1:-https://maxgierlachowski.github.io/agentbox/install.sh}"
C="${CONTAINER:-agentbox-video}"
PORT="${PORT:-38443}"
OUT="${OUT:-$HERE/out}"
mkdir -p "$OUT"

docker build -q -t agentbox-testvm "$HERE" >/dev/null
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" --hostname agentbox --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
  -p "127.0.0.1:$PORT:8443" agentbox-testvm >/dev/null
until docker exec "$C" systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded'; do sleep 1; done
docker cp "$HERE/demo-install.sh" "$C:/tmp/demo-install.sh"

DOCKER_CLI_HINTS=false asciinema rec --headless --overwrite -f asciicast-v2 --window-size 120x34 \
  -c "docker exec -it -u ubuntu $C bash /tmp/demo-install.sh $URL" "$OUT/terminal.raw.cast"
bun "$HERE/timelapse.ts" "$OUT/terminal.raw.cast" "$OUT/terminal.cast" "$OUT/terminal.fast.json" 8

# The one-time code for the browser part.
grep -o '#otp=[a-z-]*' "$OUT/terminal.raw.cast" | head -1 | sed 's/#otp=//; s/-/ /g' >"$OUT/otp.txt"
[ -s "$OUT/otp.txt" ] || { echo "no one-time code in the recording" >&2; exit 1; }
echo "terminal recorded → $OUT/terminal.cast (box on https://127.0.0.1:$PORT)"
