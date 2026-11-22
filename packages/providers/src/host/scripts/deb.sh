#!/usr/bin/env bash
# deb.sh PACKAGE VERSION URL SHA256 — install a pinned .deb (gh, glab). Root, idempotent.
set -euo pipefail
PKG="$1"; VERSION="$2"; URL="$3"; SHA="$4"
have="$(dpkg-query -W -f='${Version}' "$PKG" 2>/dev/null || true)"
if [ "$have" = "$VERSION" ]; then echo "[$PKG] $VERSION already installed"; exit 0; fi
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/pkg.deb" "$URL"
echo "$SHA  $tmp/pkg.deb" | sha256sum -c --quiet -
chmod 0755 "$tmp"; chmod 0644 "$tmp/pkg.deb"
DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y -qq --no-install-recommends "$tmp/pkg.deb" >/dev/null
echo "[$PKG] ok: $(dpkg-query -W -f='${Version}' "$PKG")"
