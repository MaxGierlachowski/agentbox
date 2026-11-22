#!/usr/bin/env bash
# cli.sh PLAN — install a catalog CLI (`cli.<name>` plan ids). Root, idempotent.
# gh/glab come with `agentbox up`; the rest is installed on demand from the config UI.
set -euo pipefail
PLAN="$1"
export DEBIAN_FRONTEND=noninteractive
arch="$(dpkg --print-architecture)"
apt_install() {
  local missing=() p
  for p in "$@"; do dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p"); done
  [ "${#missing[@]}" -eq 0 ] && return 0
  apt-get update -qq && apt-get install -y -qq --no-install-recommends "${missing[@]}" >/dev/null
}
case "$PLAN" in
  cli.git) apt_install git ;;
  cli.jq) apt_install jq ;;
  cli.ripgrep) apt_install ripgrep ;;
  cli.psql) apt_install postgresql-client ;;
  cli.docker)
    apt_install docker.io
    usermod -aG docker agentbox ;;
  cli.uv)
    V=0.13.9
    case "$arch" in amd64) T=x86_64-unknown-linux-gnu ;; arm64) T=aarch64-unknown-linux-gnu ;; esac
    if ! /usr/local/bin/uv --version 2>/dev/null | grep -q " $V"; then
      tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
      base="https://github.com/astral-sh/uv/releases/download/$V/uv-$T.tar.gz"
      curl -fsSL --retry 3 -o "$tmp/uv.tgz" "$base"
      curl -fsSL --retry 3 -o "$tmp/uv.sha" "$base.sha256"
      echo "$(cut -d' ' -f1 "$tmp/uv.sha")  $tmp/uv.tgz" | sha256sum -c --quiet -
      install -d /opt/agentbox/vendor/uv/$V
      tar -xzf "$tmp/uv.tgz" -C /opt/agentbox/vendor/uv/$V --strip-components=1
      ln -sfn /opt/agentbox/vendor/uv/$V/uv /usr/local/bin/uv
      ln -sfn /opt/agentbox/vendor/uv/$V/uvx /usr/local/bin/uvx
    fi ;;
  cli.gh|cli.glab) echo "$PLAN is installed by agentbox up" ;;
  *) echo "$PLAN cannot be installed automatically yet; install it with apt or the vendor's instructions" >&2; exit 2 ;;
esac
echo "[cli] $PLAN ok"
