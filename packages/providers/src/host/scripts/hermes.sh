#!/usr/bin/env bash
# install-hermes.sh — headless, pinned Hermes Agent install for agentbox (spike S2).
#
# Usage (as root):  install-hermes.sh [VERSION] [USER] [HERMES_HOME]
#   VERSION      upstream tag, default v0.23.3
#   USER         service user, default agentbox (created with uid $AGENTBOX_UID, default 10001)
#   HERMES_HOME  default /home/<USER>/.hermes
# Env:
#   HERMES_EXTRAS   space-separated pm extras on top of [all] (default: "slack edge-tts stt-whisper anthropic")
#   HERMES_COMMIT   optional expected commit SHA of VERSION (fails if the tag points elsewhere)
#   HERMES_FORCE=1  re-run the dependency sync even if the install stamp matches
#
# Layout produced:
#   /opt/agentbox/vendor/hermes-agent/<VERSION>/   root-owned git checkout (code + .hermes/bin launchers)
#   $HERMES_HOME/tools/      pm tool store (uv, CPython 3.14, node 26, npm, pnpm, ffmpeg, ripgrep)  ~850 MB
#   $HERMES_HOME/installs/   pm dependency environments (venv generations)                          ~1 GB
#   /usr/local/bin/hermes    wrapper (defaults HERMES_HOME)
# The pm state under $HERMES_HOME MUST be owned by USER: Hermes takes locks and repairs/extends
# the venv there at runtime (tested: root-owned installs/ => "install state is not writable").
#
# Idempotent: re-running with the same arguments is a no-op apart from apt and config checks.
set -euo pipefail

VERSION="${1:-v0.23.3}"
SVC_USER="${2:-agentbox}"
HERMES_HOME="${3:-/home/${SVC_USER}/.hermes}"
AGENTBOX_UID="${AGENTBOX_UID:-10001}"
EXTRAS="${HERMES_EXTRAS:-slack edge-tts stt-whisper anthropic}"
REPO_URL="https://github.com/NousResearch/hermes-agent"
BASE=/opt/agentbox/vendor/hermes-agent
SRC="$BASE/$VERSION"
STAMP="$SRC/.agentbox-install.json"

log() { printf '[install-hermes] %s\n' "$*"; }
die() { printf '[install-hermes] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
case "$VERSION" in v[0-9]*.[0-9]*.[0-9]*) ;; *) die "VERSION must be a stable vX.Y.Z tag (got $VERSION)";; esac
case "$VERSION" in *canary*|*rc*|*+*) die "refusing non-stable tag $VERSION";; esac

case "$(uname -m)" in
  aarch64|arm64) TARGET=linux-arm64 ;;
  x86_64|amd64) TARGET=linux-x64 ;;
  *) die "unsupported arch $(uname -m)" ;;
esac

# ---------------------------------------------------------------- apt deps
# git: clone + Hermes reads its version from git; curl/ca-certificates: uv bootstrap;
# libatomic1: pm's pinned Node 26 needs libatomic.so.1 (pm would otherwise try `sudo apt-get`).
APT_PKGS=(git ca-certificates curl libatomic1)
missing=()
for p in "${APT_PKGS[@]}"; do dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p"); done
if [ "${#missing[@]}" -gt 0 ]; then
  log "apt install ${missing[*]}"
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o DPkg::Lock::Timeout=600 update -qq
  apt-get -o DPkg::Lock::Timeout=600 install -y -qq --no-install-recommends "${missing[@]}" >/dev/null
fi

# ---------------------------------------------------------------- service user
if ! id "$SVC_USER" >/dev/null 2>&1; then
  log "creating user $SVC_USER (uid $AGENTBOX_UID)"
  useradd --uid "$AGENTBOX_UID" --create-home --shell /bin/bash "$SVC_USER"
fi
SVC_GROUP="$(id -gn "$SVC_USER")"
install -d -o "$SVC_USER" -g "$SVC_GROUP" -m 0750 "$HERMES_HOME"

# ---------------------------------------------------------------- source checkout (root-owned)
if [ -d "$SRC/.git" ]; then
  have="$(git -C "$SRC" describe --tags --exact-match 2>/dev/null || true)"
  [ "$have" = "$VERSION" ] || die "$SRC exists but is not at $VERSION (found '${have:-?}'); move it aside"
  log "checkout $SRC present"
else
  log "cloning $VERSION into $SRC"
  install -d -m 0755 "$BASE"
  tmp="$(mktemp -d "$BASE/.clone-XXXXXX")"
  git -c advice.detachedHead=false clone -q --depth 1 --branch "$VERSION" "$REPO_URL" "$tmp/tree"
  mv "$tmp/tree" "$SRC"; rmdir "$tmp"
fi
COMMIT="$(git -C "$SRC" rev-parse HEAD)"
[ -z "${HERMES_COMMIT:-}" ] || [ "$COMMIT" = "$HERMES_COMMIT" ] || die "tag $VERSION is $COMMIT, expected $HERMES_COMMIT"
chown -R root:root "$SRC"; chmod -R go-w "$SRC"
# Hermes runs git in its install dir as $SVC_USER; without this git refuses ("dubious ownership")
# and `hermes --version` prints "vunknown".
git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$SRC" \
  || git config --system --add safe.directory "$SRC"

# ---------------------------------------------------------------- dependency install via pm
want="$(printf '{"version":"%s","commit":"%s","hermes_home":"%s","user":"%s","extras":"%s","target":"%s"}' \
  "$VERSION" "$COMMIT" "$HERMES_HOME" "$SVC_USER" "$EXTRAS" "$TARGET")"
if [ "${HERMES_FORCE:-0}" != 1 ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$want" ] \
   && [ -x "$SRC/.hermes/bin/hermes" ] \
   && runuser -u "$SVC_USER" -- env HOME="$(getent passwd "$SVC_USER" | cut -d: -f6)" HERMES_HOME="$HERMES_HOME" \
        "$SRC/.hermes/bin/hermes" --version >/dev/null 2>&1; then
  log "dependencies already installed for $VERSION ($TARGET), skipping pm"
else
  # Read the uv pin for this target from pm/lock.json (same awk reader as setup-hermes.sh).
  pin() { awk -F '"' -v package="${2:-uv}" -v target="$TARGET" -v field="$1" '
      /^[[:space:]]*("[^"]+"[[:space:]]*:[[:space:]]*)?\{[[:space:]]*$/ { path[++depth] = $2; next }
      /^[[:space:]]*}[[:space:]]*,?[[:space:]]*$/ { delete path[depth--]; next }
      path[2] == "packages" && path[3] == package && $2 == field &&
        ((field == "version" && depth == 3) || (depth == 5 && path[4] == "artifacts" && path[5] == target)) { print $4; exit }
    ' "$SRC/pm/lock.json"; }
  uv_version="$(pin version)"; uv_url="$(pin url)"; uv_sha="$(pin sha256)"
  py_minor="$(pin version python | cut -d+ -f1 | cut -d. -f1,2)"
  [ -n "$uv_version" ] && [ -n "$uv_url" ] && [ -n "$uv_sha" ] && [ -n "$py_minor" ] || die "cannot read uv/python pins from pm/lock.json"

  export HERMES_HOME UV_NO_CONFIG=1
  uv_entry="$HERMES_HOME/tools/uv-$uv_version-$TARGET"
  if [ ! -x "$uv_entry/uv" ]; then
    log "staging pinned uv $uv_version ($TARGET)"
    work="$(mktemp -d)"
    curl -fsSL --retry 3 -o "$work/uv.tgz" "$uv_url"
    echo "$uv_sha  $work/uv.tgz" | sha256sum -c --quiet - || die "uv sha256 mismatch"
    install -d "$uv_entry"
    tar -o -xzf "$work/uv.tgz" -C "$uv_entry" --strip-components=1
    rm -f "$work/uv.tgz"; rmdir "$work"
  fi

  # Bootstrap interpreter only boots pm; keep it out of /root and delete it afterwards.
  boot_dir="$(mktemp -d /tmp/hermes-boot-XXXXXX)"
  export UV_PYTHON_INSTALL_DIR="$boot_dir/python" UV_CACHE_DIR="$boot_dir/cache"
  log "bootstrap CPython $py_minor"
  "$uv_entry/uv" python install --quiet --no-bin --no-registry "$py_minor"
  boot_py="$("$uv_entry/uv" python find --managed-python "$py_minor")"

  t0=$(date +%s)
  log "pm install (tools + [all]; without chromium, cua-driver)"
  # --without cannot be combined with --extra (pm: "--without shapes the default closure").
  (cd "$SRC" && "$boot_py" -m pm.cli install --without chromium --without cua-driver) \
    | grep -vE '[0-9]+\.[0-9]%' || die "pm install failed"
  if [ -n "$EXTRAS" ]; then
    extra_args=(); for e in $EXTRAS; do extra_args+=(--extra "$e"); done
    log "pm install extras: $EXTRAS"
    (cd "$SRC" && "$boot_py" -m pm.cli install "${extra_args[@]}") | grep -vE '[0-9]+\.[0-9]%' || die "pm extras failed"
  fi
  log "pm finished in $(( $(date +%s) - t0 ))s"
  rm -rf -- "$boot_dir"
  unset UV_PYTHON_INSTALL_DIR UV_CACHE_DIR
  printf '%s\n' "$want" > "$STAMP"
fi
[ -x "$SRC/.hermes/bin/hermes" ] || die "pm did not publish $SRC/.hermes/bin/hermes"
chown -R "$SVC_USER:$SVC_GROUP" "$HERMES_HOME"

# ---------------------------------------------------------------- wrapper
cat > /usr/local/bin/hermes.new <<EOF
#!/bin/sh
# agentbox wrapper for Hermes $VERSION (generated by install-hermes.sh)
export HERMES_HOME="\${HERMES_HOME:-$HERMES_HOME}"
exec $SRC/.hermes/bin/hermes "\$@"
EOF
chmod 0755 /usr/local/bin/hermes.new
mv -f /usr/local/bin/hermes.new /usr/local/bin/hermes

# ---------------------------------------------------------------- pin-holding defaults
as_user() { runuser -u "$SVC_USER" -- env HOME="$(getent passwd "$SVC_USER" | cut -d: -f6)" HERMES_HOME="$HERMES_HOME" "$@"; }
set_if() { # key value: only write when different (keeps config.yaml untouched on re-runs)
  cur="$(cd / && as_user /usr/local/bin/hermes config get "$1" 2>/dev/null </dev/null || true)"
  # `config get` prints booleans as False (written) or false (default): compare case-insensitively
  [ "${cur,,}" = "${2,,}" ] || (cd /&& as_user /usr/local/bin/hermes config set "$1" "$2" </dev/null >/dev/null)
}
set_if updates.check false                    # no passive update/banner checks (hermes --version phoned GitHub)
set_if plugins.auto_update_check_hours 0      # no gateway plugin update checks
set_if plugins.auto_apply false               # never apply plugin updates unattended
set_if telemetry.shared_metrics.enabled false # default already false; make it explicit
set_if telemetry.shared_metrics.send false

ver="$(cd / && as_user /usr/local/bin/hermes --version </dev/null | head -1)"
log "ok: $ver"
