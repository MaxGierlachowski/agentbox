#!/usr/bin/env bash
# Acceptance test for a fresh Ubuntu 24.04 VM (Proxmox or any other), run from a workstation.
#
#   VM=ubuntu@192.168.1.50 ./e2e/vm/acceptance.sh              all automatic stages
#   VM=ubuntu@192.168.1.50 ./e2e/vm/acceptance.sh health claim  selected stages
#
# Needs: ssh access with passwordless sudo on the VM, curl, jq, and `agentbox` on this machine
# for the iroh stage (download agentbox-darwin-arm64 / -linux-x64 from the same release).
# Env: INSTALL_URL (default: the release's install.sh), E2E_PASSWORD, AGENTBOX_BIN (local binary).
# Stages that need real accounts (Claude login, gh device flow, site logins, phone pairing) are
# manual: see VM-TEST.md. Exits non-zero on the first failure and names the stage.
set -euo pipefail

: "${VM:?set VM=user@host}"
INSTALL_URL="${INSTALL_URL:-https://maxgierlachowski.github.io/agentbox/install.sh}"
E2E_PASSWORD="${E2E_PASSWORD:-correct horse battery staple $RANDOM}"
AGENTBOX_BIN="${AGENTBOX_BIN:-agentbox}"
HOST="${VM#*@}"
WORK="$(mktemp -d)"
JAR="$WORK/cookies"
trap 'rm -rf "$WORK"; [ -n "${CPID:-}" ] && kill "$CPID" 2>/dev/null || true' EXIT

SSH=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$VM")
stage() { printf '\n\033[1m== %s\033[0m\n' "$1"; CURRENT="$1"; }
ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✖ %s (stage %s)\033[0m\n' "$*" "${CURRENT:-?}" >&2; exit 1; }
remote() { "${SSH[@]}" "$@"; }
code() { curl -sk -o /dev/null -w '%{http_code}' "$@"; }

st_install() {
  stage install
  remote "curl -fsSL '$INSTALL_URL' | sudo AGENTBOX_UP=1 sh" | tee "$WORK/up.log"
  grep -q 'Agentbox is running (9/9 services healthy)' "$WORK/up.log" || fail "not all services healthy"
  grep -oE '#otp=[a-z-]+' "$WORK/up.log" | head -1 | cut -d= -f2 > "$WORK/otp" || true
  ok "installed and running"
}

st_idempotent() {
  stage idempotent
  remote 'sudo agentbox up' | tee "$WORK/up2.log" | tail -3
  grep -q 'noop' "$WORK/up2.log" || fail "second run changed something"
  ok "second run is a noop"
}

st_health() {
  stage health
  for u in 7777/healthz 8080/healthz 8787/api/health 6767/api/health 9333/json/version; do
    remote "curl -fsS -o /dev/null http://127.0.0.1:$u" || fail "127.0.0.1:$u"
    ok "127.0.0.1:$u"
  done
  remote 'systemctl is-active agentbox.target agentbox-config agentbox-caddy agentbox-iroh agentbox-hermes agentbox-hermes-ui agentbox-paseo agentbox-kasmvnc agentbox-chrome' >/dev/null || fail "a unit is not active"
  ok "all units active"
  # Only sshd and the LAN listener may face the network (TCP and UDP).
  # UDP: iroh-gateway's QUIC sockets are expected (authenticated, allow-listed); Xvnc's UDP :6901
  # is dropped by agentbox-firewall. Everything else must be loopback.
  exposed="$(remote "sudo ss -tulnpH" | grep -v 'iroh-gateway' | awk '{print $1, $5}' | sed -E 's/%[^:]+:/:/' \
    | grep -vE ' (127\.0\.0\.[0-9]+|\[::1\]|\[::ffff:127\.0\.0\.1\]):|^tcp .*:(22|8443)$|^udp .*:6901$' || true)"
  [ -z "$exposed" ] || fail "unexpected listeners: $exposed"
  remote "sudo iptables -C INPUT ! -i lo -p udp --dport 6901 -j DROP" || fail "KasmVNC UDP not firewalled"
  ok "only :22 and :8443 (TCP) and iroh QUIC face the network; Xvnc UDP is firewalled"
  [ "$(code "https://$HOST:8443/browser/")" != 200 ] || fail "/browser/ without login"
  curl -s -m 3 "http://$HOST:9333/json/version" >/dev/null && fail "CDP reachable from outside" || ok "CDP not reachable from outside"
}

st_claim() {
  stage claim
  OTP="$(cat "$WORK/otp" 2>/dev/null || true)"
  [ -n "$OTP" ] || OTP="$(remote 'sudo agentbox otp' | grep -oE '#otp=[a-z-]+' | head -1 | cut -d= -f2)"
  body="$(jq -nc --arg otp "$OTP" --arg pw "$E2E_PASSWORD" '{otp:$otp,name:"E2E",email:"e2e@example.com",password:$pw}')"
  curl -sk -c "$JAR" -H 'content-type: application/json' -H "origin: https://$HOST:8443" \
    -X POST "https://$HOST:8443/api/setup/claim" -d "$body" | jq -e .ok >/dev/null || fail "claim"
  ok "claimed"
  [ "$(code "https://$HOST:8443/setup/")" = 404 ] || fail "/setup still served"
  ok "/setup is gone"
  [ "$(code -b "$JAR" "https://$HOST:8443/hermes/")" = 200 ] || fail "Hermes UI with session"
  ok "Hermes UI behind the login"
  [ "$(code -b "$JAR" "https://$HOST:8443/browser/?path=browser/websockify")" = 200 ] || fail "browser stream with session"
  ok "browser stream behind the login"
}

st_browser() {
  stage browser
  remote "python3 - <<'PY'
import json, urllib.request
v = json.load(urllib.request.urlopen('http://127.0.0.1:9333/json/version'))
assert 'Browser' in v, v
print('  ✔', v['Browser'])
PY"
  remote 'sudo systemctl restart agentbox-chrome && sleep 4 && curl -fsS -o /dev/null http://127.0.0.1:9333/json/version' || fail "Chrome restart"
  ok "Chrome restarts cleanly"
}

st_iroh() {
  stage iroh
  command -v "$AGENTBOX_BIN" >/dev/null || fail "agentbox binary for this machine not found (AGENTBOX_BIN)"
  pair="$(curl -sk -b "$JAR" -H 'content-type: application/json' -H "origin: https://$HOST:8443" \
    -X POST "https://$HOST:8443/api/rpc/devices/pairStart" -d '{"json":{"kind":"laptop"}}')"
  id="$(jq -r '.json.endpointId' <<<"$pair")"; pc="$(jq -r '.json.code' <<<"$pair")"
  [ -n "$id" ] && [ "$id" != null ] || fail "pairStart: $pair"
  AGENTBOX_CONNECT_DIR="$WORK/connect" "$AGENTBOX_BIN" connect "$id" --code "$pc" --port 18080 --name e2e >"$WORK/connect.log" 2>&1 &
  CPID=$!
  for _ in $(seq 1 30); do grep -q 'localhost:18080' "$WORK/connect.log" && break; sleep 1; done
  curl -fsS http://localhost:18080/api/rpc/auth/me | jq -e '.json.via == "device"' >/dev/null || fail "config API over iroh"
  ok "config API over iroh (paired device)"
  [ "$(code http://localhost:18080/hermes/)" = 200 ] || fail "Hermes UI over iroh"
  ok "Hermes UI over iroh"
  [ "$(code http://localhost:18080/browser/?path=browser/websockify)" = 200 ] || fail "browser stream over iroh"
  ok "browser stream over iroh"
  dev="$(curl -sk -b "$JAR" "https://$HOST:8443/api/rpc/devices/list" | jq -r '.json[0].id')"
  curl -sk -b "$JAR" -H 'content-type: application/json' -H "origin: https://$HOST:8443" \
    -X POST "https://$HOST:8443/api/rpc/devices/revoke" -d "{\"json\":{\"id\":\"$dev\"}}" >/dev/null
  sleep 3
  [ "$(code http://localhost:18080/api/rpc/auth/me)" != 200 ] || fail "revoked device still has access"
  ok "revoke cuts access"
  kill "$CPID" 2>/dev/null || true; CPID=""
}

st_reboot() {
  stage reboot
  remote 'sudo systemctl reboot' || true
  sleep 20
  for _ in $(seq 1 30); do remote true 2>/dev/null && break; sleep 5; done
  for _ in $(seq 1 30); do remote 'systemctl is-active --quiet agentbox-config agentbox-hermes agentbox-chrome' && break; sleep 5; done
  remote 'sudo agentbox doctor --json' | jq -e '.fail == 0' >/dev/null || fail "doctor after reboot"
  ok "everything back after reboot"
}

STAGES=("$@")
[ "${#STAGES[@]}" -gt 0 ] || STAGES=(install health claim browser idempotent iroh reboot)
for s in "${STAGES[@]}"; do "st_$s"; done
printf '\n\033[32mACCEPTANCE PASSED\033[0m (%s)\n' "${STAGES[*]}"
