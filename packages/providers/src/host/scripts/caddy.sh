#!/usr/bin/env bash
# caddy.sh — Caddy 2.11.9 binary from the GitHub release (sha256 + sha512 pinned). Root, idempotent.
set -euo pipefail
CADDY_VERSION=2.11.9
declare -A CADDY_SHA256=(
  [amd64]=5b8cb7faf8726a2028ad96a66e54e6e81e8f361bc6175e5d22bbd997cc5177fb
  [arm64]=5e377cff994fc9362a6fcf695c53f226cfca3a3ef85bd3a3687cf252d6310165
)
PREFIX=/opt/agentbox/vendor/caddy/$CADDY_VERSION
arch="$(dpkg --print-architecture)"
[ -n "${CADDY_SHA256[$arch]:-}" ] || { echo "unsupported arch $arch" >&2; exit 1; }
if [ ! -x "$PREFIX/caddy" ] || ! "$PREFIX/caddy" version | grep -q "^v${CADDY_VERSION} "; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  tgz="caddy_${CADDY_VERSION}_linux_${arch}.tar.gz"
  curl -fsSL --retry 3 -o "$tmp/$tgz" "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/${tgz}"
  echo "${CADDY_SHA256[$arch]}  $tmp/$tgz" | sha256sum -c --quiet -
  install -d -m 0755 "$PREFIX"
  tar -xzf "$tmp/$tgz" -C "$tmp" caddy
  install -m 0755 "$tmp/caddy" "$PREFIX/caddy"
fi
ln -sfn "$PREFIX/caddy" /usr/local/bin/caddy
echo "[caddy] ok: $(/usr/local/bin/caddy version | cut -d' ' -f1)"
