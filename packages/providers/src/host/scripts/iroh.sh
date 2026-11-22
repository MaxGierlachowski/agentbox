#!/usr/bin/env bash
# iroh.sh — iroh-gateway 0.6.4 (irohkit/iroh-bridge, musl build, sha256 pinned). Root, idempotent.
set -euo pipefail
IROH_VERSION=0.6.4
declare -A IROH_SHA256=(
  [amd64]=924ab1ad6f0edd3978d69006a9961ceb98a31eeccd204c0f462c4ce410507b4b
  [arm64]=78931ce415fe6c16185483eb1c0c42c49d42ef691b26962ecfde1b3a7c56423a
)
declare -A IROH_TRIPLE=([amd64]=x86_64-unknown-linux-musl [arm64]=aarch64-unknown-linux-musl)
PREFIX=/opt/agentbox/vendor/iroh-gateway/$IROH_VERSION
arch="$(dpkg --print-architecture)"
[ -n "${IROH_SHA256[$arch]:-}" ] || { echo "unsupported arch $arch" >&2; exit 1; }
if [ ! -x "$PREFIX/iroh-gateway" ] || ! "$PREFIX/iroh-gateway" --version | grep -qx "iroh-gateway $IROH_VERSION"; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  name="iroh-gateway-v${IROH_VERSION}-${IROH_TRIPLE[$arch]}"
  curl -fsSL --retry 3 -o "$tmp/$name.tar.gz" "https://github.com/irohkit/iroh-bridge/releases/download/v${IROH_VERSION}/$name.tar.gz"
  echo "${IROH_SHA256[$arch]}  $tmp/$name.tar.gz" | sha256sum -c --quiet -
  tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
  install -d -m 0755 "$PREFIX"
  install -m 0755 "$tmp/$name/iroh-gateway" "$PREFIX/iroh-gateway"
fi
ln -sfn "$PREFIX/iroh-gateway" /usr/local/bin/iroh-gateway
echo "[iroh] ok: $(/usr/local/bin/iroh-gateway --version)"
