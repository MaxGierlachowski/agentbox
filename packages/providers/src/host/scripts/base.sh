#!/usr/bin/env bash
# base.sh — OS packages, service users and directories for agentbox (run as root, idempotent).
set -euo pipefail
log() { printf '[base] %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

PKGS=(ca-certificates curl git jq tmux openssl iptables iproute2 openssh-client sudo unzip xz-utils
      python3 gnupg xdg-utils fonts-noto-core libatomic1 lbzip2)
missing=()
for p in "${PKGS[@]}"; do dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p"); done
if [ "${#missing[@]}" -gt 0 ]; then
  log "apt install ${missing[*]}"
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends "${missing[@]}" >/dev/null
fi

# Service user (agents, Hermes, Paseo, browser) and edge user (Caddy, iroh-gateway).
id agentbox >/dev/null 2>&1 || useradd --uid "${AGENTBOX_UID:-10001}" --user-group --create-home --shell /bin/bash agentbox
getent passwd agentbox-edge >/dev/null || \
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin agentbox-edge
# The gateway reads the access file agentbox renders (group agentbox, 0640).
id -nG agentbox-edge | tr ' ' '\n' | grep -qx agentbox || usermod -aG agentbox agentbox-edge

install -d -m 0755 /opt/agentbox /opt/agentbox/vendor /opt/agentbox/releases /etc/agentbox /usr/local/lib/agentbox
install -d -m 0755 /var/lib/agentbox
install -d -o agentbox -g agentbox -m 0700 /var/lib/agentbox/state /var/lib/agentbox/secrets \
  /var/lib/agentbox/chrome-profile /var/lib/agentbox/hermes-ui /var/lib/agentbox/cache
install -d -o agentbox -g agentbox -m 0750 /var/lib/agentbox/iroh-access
install -d -o agentbox-edge -g agentbox-edge -m 0700 /var/lib/agentbox/iroh /var/lib/agentbox/caddy
install -d -o agentbox -g agentbox -m 0755 /home/agentbox/work
install -d -o agentbox -g agentbox -m 0700 /home/agentbox/.claude-accounts /home/agentbox/.config
log "ok"
