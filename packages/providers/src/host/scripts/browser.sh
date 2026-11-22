#!/usr/bin/env bash
# Spike S6: install the box browser on Ubuntu 24.04.
#   default (x64 + arm64): Google Chrome stable from Google's signed apt repo. Since 2026 the repo
#     publishes google-chrome-stable for arm64 too (verified 2026-11-22: 158.0.8127.36-1 in
#     dists/stable/main/binary-arm64), so one path covers both arches.
#   AGENTBOX_BROWSER_SOURCE=cft: pinned Chrome for Testing zip (Google, linux64 / linux-arm64) as a
#     fallback when apt is not wanted. No auto-updates; bump the pin in the manifest.
# Idempotent. Run as root. Installs agentbox-chrome.service when it sits next to this script.
set -euo pipefail
# systemd may be absent (plain containers used to test the x64 install path): skip unit control then.
sysd() { if [ -d /run/systemd/system ]; then systemctl "$@"; else return 0; fi; }

GOOGLE_KEY_URL=https://dl.google.com/linux/linux_signing_key.pub
# Primary key fingerprint (signing subkeys rotate; the primary stays).
GOOGLE_KEY_FPR=EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796
# Same paths/format the google-chrome-stable postinst manages (deb822, new chrome-stable URI).
# The postinst rewrites this file on every upgrade with identical content and its embedded key,
# and deletes a legacy google-chrome.list, so we write exactly what it would write.
KEYRING=/usr/share/keyrings/google-chrome.gpg
SOURCES=/etc/apt/sources.list.d/google-chrome.sources

CFT_VERSION=158.0.8127.36
declare -A CFT_SHA256=(
  [amd64]=dba9cc838e1ce269c33ea68170881127bd15d078fc3ca5891c90802819a4d7c7
  [arm64]=f811b64a50cbc73f94fda7b3f3b3bf62be5d9409b3207e6ead9b61e6706afffe
)

AB_USER=agentbox
PROFILE_DIR=/var/lib/agentbox/chrome-profile

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
arch="$(dpkg --print-architecture)"
case "$arch" in amd64|arm64) ;; *) echo "unsupported arch $arch" >&2; exit 1;; esac
export DEBIAN_FRONTEND=noninteractive
source="${AGENTBOX_BROWSER_SOURCE:-apt}"

need() { local p; for p in "$@"; do dpkg -s "$p" >/dev/null 2>&1 || echo "$p"; done; }

install_apt() {
  local missing; missing="$(need ca-certificates curl gnupg)"
  if [ -n "$missing" ]; then apt-get update -qq; apt-get install -y -qq --no-install-recommends $missing >/dev/null; fi

  local tmp; tmp="$(mktemp -d)"
  curl -fsSL --retry 3 "$GOOGLE_KEY_URL" -o "$tmp/key.pub"
  local fpr
  fpr="$(gpg --batch --with-colons --show-keys "$tmp/key.pub" 2>/dev/null | awk -F: '/^fpr:/{print $10; exit}')"
  [ "$fpr" = "$GOOGLE_KEY_FPR" ] || { echo "google key fingerprint mismatch: $fpr" >&2; exit 1; }
  gpg --batch --yes --dearmor -o "$tmp/google-chrome.gpg" "$tmp/key.pub"
  install -d -m 0755 /usr/share/keyrings
  install -m 0644 "$tmp/google-chrome.gpg" "$KEYRING"
  rm -rf "$tmp"
  rm -f /etc/apt/sources.list.d/google-chrome.list
  cat >"$SOURCES" <<EOF
### THIS FILE IS AUTOMATICALLY CONFIGURED ###
# Changes to this file will not be preserved.
# This file will not be recreated if removed.
X-Repolib-Name: Google Chrome
Types: deb
URIs: https://dl.google.com/linux/chrome-stable/deb/
Suites: stable
Components: main
Architectures: $arch
Signed-By: $KEYRING
EOF
  chmod 0644 "$SOURCES"

  local want; want="$(need google-chrome-stable fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji)"
  if [ -n "$want" ]; then
    apt-get update -qq
    apt-get install -y -qq $want >/dev/null
  fi
  BROWSER_BIN=/usr/bin/google-chrome-stable
}

install_cft() {
  local plat
  if [ "$arch" = amd64 ]; then plat=linux64; else plat=linux-arm64; fi
  local dest=/opt/agentbox/vendor/chrome-for-testing/$CFT_VERSION
  BROWSER_BIN=$dest/chrome-$plat/chrome
  if [ ! -x "$BROWSER_BIN" ]; then
    local missing; missing="$(need ca-certificates curl unzip)"
    if [ -n "$missing" ]; then apt-get update -qq; apt-get install -y -qq --no-install-recommends $missing >/dev/null; fi
    local tmp; tmp="$(mktemp -d)"
    curl -fsSL --retry 3 -o "$tmp/c.zip" \
      "https://storage.googleapis.com/chrome-for-testing-public/$CFT_VERSION/$plat/chrome-$plat.zip"
    echo "${CFT_SHA256[$arch]}  $tmp/c.zip" | sha256sum -c -
    install -d -m 0755 "$dest"; unzip -q "$tmp/c.zip" -d "$dest"; rm -rf "$tmp"
    # runtime libs: CfT ships deb.deps (Debian dependency syntax); take the first alternative,
    # drop version constraints, let apt resolve noble's t64 renames via Provides.
    local pkgs=() p
    while read -r p; do
      [ -n "$p" ] || continue
      # noble renamed several libs for the 64-bit time_t transition (libasound2 -> libasound2t64)
      if [ -z "$(apt-cache policy "$p" 2>/dev/null | awk '/Candidate:/{print $2}' | grep -v none)" ] \
         && [ -n "$(apt-cache policy "${p}t64" 2>/dev/null | awk '/Candidate:/{print $2}' | grep -v none)" ]; then
        p="${p}t64"
      fi
      pkgs+=("$p")
    done < <(sed -E 's/ *\|.*//; s/ *\(.*//' "$dest/chrome-$plat/deb.deps")
    apt-get install -y -qq --no-install-recommends "${pkgs[@]}" >/dev/null
    apt-get install -y -qq --no-install-recommends fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji >/dev/null
    # setuid sandbox helper next to the binary (Chrome looks for ./chrome-sandbox): needed where
    # unprivileged user namespaces are restricted (Ubuntu 24.04 AppArmor default) and the
    # google-chrome AppArmor profile does not match this path.
    install -o root -g root -m 4755 "$dest/chrome-$plat/chrome_sandbox" "$dest/chrome-$plat/chrome-sandbox"
  fi
  ln -sfn "$BROWSER_BIN" /usr/local/bin/agentbox-chrome
}

case "$source" in
  apt) install_apt ;;
  cft) install_cft ;;
  *) echo "unknown AGENTBOX_BROWSER_SOURCE=$source" >&2; exit 1 ;;
esac

# Persistent profile, private to the service user.
if getent passwd "$AB_USER" >/dev/null; then
  install -d -o "$AB_USER" -g "$AB_USER" -m 0700 "$PROFILE_DIR"
fi

ln -sfn "$BROWSER_BIN" /usr/local/bin/agentbox-chrome
"$BROWSER_BIN" --version
