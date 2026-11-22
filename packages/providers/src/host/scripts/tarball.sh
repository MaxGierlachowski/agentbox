#!/usr/bin/env bash
# tarball.sh NAME VERSION URL SHA256 — unpack a release tarball to /opt/agentbox/vendor/NAME/VERSION.
# URL may be file:///… (local artifacts). Root-owned, read-only for the service user. Idempotent.
set -euo pipefail
NAME="$1"; VERSION="$2"; URL="$3"; SHA="$4"
DEST="/opt/agentbox/vendor/$NAME/$VERSION"
STAMP="$DEST/.agentbox-sha256"
if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$SHA" ]; then echo "[$NAME] $VERSION already installed"; exit 0; fi
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/a.tgz" "$URL"
echo "$SHA  $tmp/a.tgz" | sha256sum -c --quiet - || { echo "[$NAME] sha256 mismatch for $URL" >&2; exit 1; }
mkdir "$tmp/tree"; tar -xzf "$tmp/a.tgz" -C "$tmp/tree"
chown -R root:root "$tmp/tree"; chmod -R go-w,a+rX "$tmp/tree"
install -d -m 0755 "/opt/agentbox/vendor/$NAME"
rm -rf -- "$DEST"; mv "$tmp/tree" "$DEST"
printf '%s\n' "$SHA" > "$STAMP"
echo "[$NAME] ok: $VERSION"
