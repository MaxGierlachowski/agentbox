#!/bin/sh
# BROWSER helper: opens a URL in the box's shared Chrome (CDP on loopback), e.g. OAuth consent
# pages started by Hermes or CLIs whose callback must land on this machine.
url="$1"
[ -n "$url" ] || exit 1
exec curl -fsS -o /dev/null -X PUT "http://127.0.0.1:9333/json/new?$(printf '%s' "$url" | jq -sRr @uri)"
