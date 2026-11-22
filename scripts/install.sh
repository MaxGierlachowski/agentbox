#!/bin/sh
# agentbox installer: downloads the agentbox binary for this machine, verifies it and installs it.
#
#   curl -fsSL <release>/install.sh | sudo AGENTBOX_UP=1 sh      install and run `agentbox up`
#   curl -fsSL <release>/install.sh | sudo sh                    install only
#
# Env: AGENTBOX_VERSION (pinned below), AGENTBOX_UP=1, AGENTBOX_LISTEN=lan|local,
#      AGENTBOX_BASE_URL (where releases live; swap in your own mirror or domain).
set -eu

AGENTBOX_VERSION="${AGENTBOX_VERSION:-0.0.0-dev}"
AGENTBOX_BASE_URL="${AGENTBOX_BASE_URL:-https://github.com/MaxGierlachowski/agentbox/releases/download}"

say() { printf '%s\n' "$*"; }
die() { printf 'agentbox install: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root, e.g. curl -fsSL … | sudo sh"

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
fi
[ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID:-}" = "24.04" ] || die "agentbox supports Ubuntu 24.04 (found ${PRETTY_NAME:-unknown})"

case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "unsupported CPU $(uname -m) (x86_64 and arm64 are supported)" ;;
esac

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"

TAG="v${AGENTBOX_VERSION}"
BIN="agentbox-linux-${ARCH}"
URL="${AGENTBOX_BASE_URL}/${TAG}"
DEST="/opt/agentbox/releases/${AGENTBOX_VERSION}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "agentbox ${AGENTBOX_VERSION} (linux-${ARCH})"
say "  downloading ${URL}/${BIN}"
curl -fsSL --retry 3 -o "$tmp/$BIN" "${URL}/${BIN}" || die "download failed: ${URL}/${BIN}"
curl -fsSL --retry 3 -o "$tmp/SHA256SUMS" "${URL}/SHA256SUMS" || die "download failed: ${URL}/SHA256SUMS"
expected="$(awk -v f="$BIN" '$2 == f { print $1 }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || die "$BIN is not listed in SHA256SUMS"
actual="$(sha256sum "$tmp/$BIN" | cut -d' ' -f1)"
[ "$expected" = "$actual" ] || die "checksum mismatch for $BIN (expected $expected, got $actual)"
say "  sha256 ok"

install -d -m 0755 "$DEST"
install -m 0755 "$tmp/$BIN" "$DEST/agentbox"
ln -sfn "$DEST" /opt/agentbox/current
ln -sfn /opt/agentbox/current/agentbox /usr/local/bin/agentbox
say "  installed /usr/local/bin/agentbox"

if [ "${AGENTBOX_UP:-0}" = "1" ]; then
  say ""
  if [ -n "${AGENTBOX_LISTEN:-}" ]; then
    exec /usr/local/bin/agentbox up --listen "$AGENTBOX_LISTEN"
  fi
  exec /usr/local/bin/agentbox up
fi
say ""
say "Next: sudo agentbox up"
