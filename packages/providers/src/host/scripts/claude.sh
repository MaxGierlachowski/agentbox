#!/usr/bin/env bash
# claude.sh VERSION — pinned Claude Code CLI, no self-updates (run as root, idempotent).
set -euo pipefail
VERSION="${1:?version}"
PREFIX="/opt/agentbox/vendor/agent-clis/claude-code-$VERSION"
log() { printf '[claude] %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
have="$(node -p "try{require('$PREFIX/lib/node_modules/@anthropic-ai/claude-code/package.json').version}catch(e){''}" 2>/dev/null || true)"
if [ "$have" != "$VERSION" ]; then
  stage="$PREFIX.staging"; rm -rf -- "$stage"
  npm_config_cache="$(mktemp -d)" npm_config_update_notifier=false npm install -g --prefix "$stage" --no-fund --no-audit --loglevel=error "@anthropic-ai/claude-code@$VERSION"
  chown -R root:root "$stage"; chmod -R go-w "$stage"
  rm -rf -- "$PREFIX"; mv "$stage" "$PREFIX"
fi
cat > /usr/local/bin/claude.new <<WRAP
#!/bin/sh
# agentbox wrapper: Claude Code $VERSION (pinned; updates come with agentbox)
export DISABLE_AUTOUPDATER=1 DISABLE_UPDATES=1 DISABLE_INSTALLATION_CHECKS=1
exec $PREFIX/bin/claude "\$@"
WRAP
chmod 0755 /usr/local/bin/claude.new; mv -f /usr/local/bin/claude.new /usr/local/bin/claude
log "ok: $(/usr/local/bin/claude --version 2>/dev/null | head -1)"
