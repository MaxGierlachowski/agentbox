#!/usr/bin/env bash
# Spike S6: install KasmVNC 1.5.2 + openbox for user `agentbox` (uid 10001) on Ubuntu 24.04
# (x64 + arm64) and pre-seed everything the Perl wrapper would otherwise ask interactively.
# Idempotent: safe to re-run. Must run as root. Does not start the unit (see --start).
set -euo pipefail
# systemd may be absent (plain containers used to test the x64 install path): skip unit control then.
sysd() { if [ -d /run/systemd/system ]; then systemctl "$@"; else return 0; fi; }

KASMVNC_VERSION=1.5.2
# sha256 from the GitHub release asset digests (KasmVNC publishes no checksum file).
declare -A KASMVNC_SHA256=(
  [amd64]=89a5d1fbe9e032b122202be158a2b25f15c97e0a5b8dcf92a5e6835c7b7b2acd
  [arm64]=4d680f3d1eb77fb155ae67af7f9fa25d7fbd38a7f69ae146784c7f738e2eed1a
)
AB_USER=agentbox
AB_UID=10001
AB_HOME=/home/agentbox
WS_PORT=6901

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
arch="$(dpkg --print-architecture)"
[ -n "${KASMVNC_SHA256[$arch]:-}" ] || { echo "unsupported arch $arch" >&2; exit 1; }

# prerequisites (present on Ubuntu server images, missing in minimal containers)
_missing=""; for _p in curl ca-certificates iptables; do dpkg -s "$_p" >/dev/null 2>&1 || _missing="$_missing $_p"; done
if [ -n "$_missing" ]; then apt-get -o DPkg::Lock::Timeout=600 update -qq; DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y -qq --no-install-recommends $_missing >/dev/null; fi

export DEBIAN_FRONTEND=noninteractive

# 1. service user
if ! getent passwd "$AB_USER" >/dev/null; then
  useradd --uid "$AB_UID" --create-home --home-dir "$AB_HOME" --shell /bin/bash --user-group "$AB_USER"
fi

# 2. package (skip download when the pinned version is already installed)
installed="$(dpkg-query -W -f='${Version}' kasmvncserver 2>/dev/null || true)"
if [[ "$installed" != "${KASMVNC_VERSION}"* ]]; then
  deb="kasmvncserver_ubuntu_noble_${KASMVNC_VERSION}_${arch}.deb"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --retry 3 -o "$tmp/$deb" \
    "https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VERSION}/${deb}"
  echo "${KASMVNC_SHA256[$arch]}  $tmp/$deb" | sha256sum -c -
  chmod 0644 "$tmp/$deb"; chmod 0755 "$tmp"   # _apt sandbox user must read the file
  apt-get -o DPkg::Lock::Timeout=600 update -qq
  apt-get -o DPkg::Lock::Timeout=600 install -y -qq --no-install-recommends "$tmp/$deb" openbox xauth openssl >/dev/null
else
  { dpkg -s openbox && dpkg -s xauth && dpkg -s openssl; } >/dev/null 2>&1 || { apt-get -o DPkg::Lock::Timeout=600 update -qq; apt-get -o DPkg::Lock::Timeout=600 install -y -qq --no-install-recommends openbox xauth openssl >/dev/null; }
fi

# 3. pre-seed the wrapper's first-run state (as the service user, files owned by it)
install -d -o "$AB_USER" -g "$AB_USER" -m 0700 "$AB_HOME/.vnc"

# 3a. config: plain http on loopback (Caddy terminates TLS + auth), never prompt.
cat >"$AB_HOME/.vnc/kasmvnc.yaml" <<YAML
# managed by agentbox (S6). Re-rendered by \`agentbox up\`.
desktop:
  resolution:
    width: 1600
    height: 900
  allow_resize: true
network:
  protocol: http
  interface: 127.0.0.1
  websocket_port: ${WS_PORT}
  use_ipv4: true
  use_ipv6: false
  udp:
    public_ip: 127.0.0.1
  ssl:
    # The wrapper insists that both files are readable even with require_ssl: false; the
    # default snakeoil key needs ssl-cert group membership. Use a private, unused self-signed pair.
    pem_certificate: ${AB_HOME}/.vnc/self.pem
    pem_key: ${AB_HOME}/.vnc/self.key
    require_ssl: false
user_session:
  session_type: shared
  new_session_disconnects_existing_exclusive_session: false
  concurrent_connections_prompt: false
  idle_timeout: never
command_line:
  prompt: false
YAML

if [ ! -s "$AB_HOME/.vnc/self.pem" ] || [ ! -s "$AB_HOME/.vnc/self.key" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=localhost \
    -keyout "$AB_HOME/.vnc/self.key" -out "$AB_HOME/.vnc/self.pem" 2>/dev/null
  chmod 0600 "$AB_HOME/.vnc/self.key"
fi

# 3b. desktop: openbox is not in select-de.sh's list, so write xstartup ourselves and mark the
#     DE as selected (the wrapper only prompts when ~/.vnc/.de-was-selected is missing).
cat >"$AB_HOME/.vnc/xstartup" <<'SH'
#!/bin/sh
# managed by agentbox (S6)
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
xsetroot -solid '#20232a' 2>/dev/null || true
exec openbox-session
SH
chmod 0755 "$AB_HOME/.vnc/xstartup"
touch "$AB_HOME/.vnc/.de-was-selected"

# 3c. kasmpasswd: the wrapper exits if no user with write access exists, even with
#     -DisableBasicAuth. Create one with a random throwaway password (never printed/stored
#     in clear; basic auth is disabled, Caddy forward_auth is the gate).
if ! grep -q "^${AB_USER}:" "$AB_HOME/.kasmpasswd" 2>/dev/null; then
  pw="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  printf '%s\n%s\n' "$pw" "$pw" | runuser -u "$AB_USER" -- kasmvncpasswd -u "$AB_USER" -wo "$AB_HOME/.kasmpasswd" >/dev/null
  unset pw
fi
chmod 0600 "$AB_HOME/.kasmpasswd"
chown -R "$AB_USER:$AB_USER" "$AB_HOME/.vnc" "$AB_HOME/.kasmpasswd"

# 3d. Xvnc always binds its UDP transport (WebRTC-style, port = websocket port) on 0.0.0.0;
#     there is no interface option and udpPort can't be disabled. Drop it from anywhere but
#     loopback. Production: part of agentbox-firewall.service.
if command -v iptables >/dev/null; then
  for ipt in iptables ip6tables; do
    rule=(INPUT ! -i lo -p udp --dport "$WS_PORT" -j DROP)
    $ipt -C "${rule[@]}" 2>/dev/null || $ipt -A "${rule[@]}"
  done
fi

echo "kasmvnc ${KASMVNC_VERSION} ready for ${AB_USER}"
