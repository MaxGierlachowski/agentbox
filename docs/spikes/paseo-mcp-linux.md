# paseo-mcp on headless Linux: verification log (WP-PM-1)

Date: 2026-11-22. Repo `MaxGierlachowski/paseo-mcp`, branch `v1`, draft PR #4
(https://github.com/MaxGierlachowski/paseo-mcp/pull/4). Pre-release `v0.5.0-rc.1`.

## Environment
- Local: Docker Desktop on an arm64 Mac, container `ab-pm-verify` from `ubuntu:24.04` (native arm64), plain processes (no systemd).
- Node 24.22.3 from nodejs.org, checked against SHASUMS256. `@getpaseo/cli@0.17.3` installed globally with npm.
- Service user `agentbox` (uid 10001). Every test ran as that user.
- CI: GitHub Actions `ubuntu-24.04` (x64) and `ubuntu-24.04-arm` (arm64) run `scripts/linux-smoke.sh` on every push and PR. Both are green (runs 45055447439 and 45055453730).

## Exact commands that worked (container)

```sh
# as root
apt-get update && apt-get install -y curl ca-certificates xz-utils git
V=24.22.3; A=arm64          # x64 on amd64
curl -fsSLO https://nodejs.org/dist/v$V/node-v$V-linux-$A.tar.xz
curl -fsSL https://nodejs.org/dist/v$V/SHASUMS256.txt | grep " node-v$V-linux-$A.tar.xz$" | sha256sum -c -
mkdir -p /opt/node && tar -xJf node-v$V-linux-$A.tar.xz -C /opt/node --strip-components=1
ln -sf /opt/node/bin/{node,npm,npx} /usr/local/bin/
useradd -m -u 10001 -s /bin/bash agentbox
npm install -g @getpaseo/cli@0.17.3 && ln -sf /opt/node/bin/paseo /usr/local/bin/paseo

# plugin directory: root-owned and read-only
mkdir -p /opt/agentbox/vendor/paseo-mcp/0.5.0
tar -xzf paseo-mcp-0.5.0.tgz -C /opt/agentbox/vendor/paseo-mcp/0.5.0
chown -R root:root /opt/agentbox && chmod -R a-w /opt/agentbox/vendor/paseo-mcp/0.5.0

# as agentbox
export PASEO_HOME=/home/agentbox/.paseo
paseo daemon config set daemon.listen 127.0.0.1:6767
paseo daemon config set daemon.relay.enabled false
paseo daemon config set features.webUi.enabled false
paseo daemon config set daemon.mcp.injectIntoAgents true
paseo daemon config set daemon.browserTools.enabled false
paseo daemon config set pluginsEnabled true            # REQUIRED, see findings
paseo daemon run &                                     # systemd: ExecStart=paseo daemon run
# wait for: paseo daemon status | grep 'localDaemon: running'  (and GET /api/health)
PM=/opt/agentbox/vendor/paseo-mcp/0.5.0/paseo-mcp
paseo plugin install "$PM"                             # non-interactive; trust notice on stderr
paseo plugin ls paseo-mcp                              # STATUS running
node $PM/dist/admin.js token create --label hermes-ui --scope full --origin hermes --out /home/agentbox/hermes-ui.token
# managed settings: $PASEO_HOME/paseo-mcp.managed.json (mode 600)
#   {"http":{"enabled":true,"port":6790,"bind":"127.0.0.1"},"allowedRoots":["/home/agentbox/work"],"originLabel":"hermes", "tokens":[…written by admin…]}
curl -sS -X POST http://127.0.0.1:6790/mcp -H "Authorization: Bearer $(cat /home/agentbox/hermes-ui.token)" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
#   -> HTTP 200, SSE "data: {…serverInfo:{name:paseo,version:0.5.0}…}"; without token -> 401
env -i PATH="$PATH" HOME=/home/agentbox PASEO_MCP_CONFIG=/home/agentbox/.config/paseo-mcp/config.json \
  node "$PM/smoke.mjs" paseo_list_accounts       # -> TOOLS (11): …
# full automated run (any dir, temp PASEO_HOME, own CLI prefix):
scripts/linux-smoke.sh dist/paseo-mcp-0.5.0.tgz       # -> LINUX SMOKE OK (linux-arm64, paseo 0.17.3)
```

## Results
| Check | Result |
|---|---|
| `npm run build && npm run typecheck && npm test` (90 tests) | pass |
| `npm run release:tarball` → `dist/paseo-mcp-0.5.0.tgz` + `.sha256`, top-level `paseo-mcp/`, 5.1 MiB, no native modules, reproducible on the same platform | pass |
| `paseo plugin install <extracted dir>` from a read-only root-owned dir, status `running` | pass |
| Plugin HTTP MCP `http://127.0.0.1:6790/mcp`: initialize 200, no token 401, `full` token 11 tools, `read` token 6 tools | pass |
| Managed file picked up live (≈2 s, no restart); token revoke closes sessions live | pass |
| Agent create via HTTP (echo ACP provider, bare provider `echo` → `echo/echo`), `wait_for_agent`, events created/turn_started/turn_ended with `origin`+`origin_ref` labels | pass |
| Permission round trip: `permission_requested` (hook) → `paseo_respond_permission allow` → `permission_resolved` + `turn_ended` | pass |
| Webhook `standard-webhooks` to a loopback receiver: verified signatures, `turn_ended` and `permission_requested` with `labels.origin_ref` | pass |
| stdio `node <dir>/dist/index.js` via `smoke.mjs` with only PATH/HOME/PASEO_HOME/PASEO_MCP_CONFIG: 11 tools, list/create agents | pass |
| Update: `paseo plugin remove paseo-mcp` + `install <new dir>`: managed file kept, same token works | pass |
| Published rc assets downloaded, `sha256sum -c` OK, full smoke on them | pass |
| CI x64 + arm64 headless smoke | pass |
| Failures | none open. Fixed along the way: Paseo 0.17 rejects a bare provider (`Expected config.provider in "provider/model" format`), now resolved to the default model; the managed file's token/webhook id namespaces were shared (fixed) |

## Findings agentbox must know
1. **`pluginsEnabled: true` is required** in `$PASEO_HOME/config.json` (`paseo daemon config set pluginsEnabled true`). Without it the install succeeds, but `paseo plugin ls` shows `disabled`. After setting it on a running daemon, the plugin entries need a daemon restart. This key is missing from the Paseo config list in `v1-interfaces.md`.
2. **Race:** `/api/health` answers before the CLI finds the daemon through `$PASEO_HOME/paseo.pid`. Wait for `paseo daemon status` to show `localDaemon: running` before `paseo plugin install`, or the install fails with "Daemon is not running".
3. **HTTP endpoint:** `http://127.0.0.1:6790/mcp` (Streamable HTTP, `Authorization: Bearer <token>`). It is off until the managed file sets `http.enabled: true`. Port 6790 is not in the interfaces port table; add it (loopback only). The `Host` header must be `127.0.0.1:6790` or `localhost:6790`, so a Caddy proxy in front must keep the Host header or call it directly on loopback.
4. **Tokens, non-interactive:** `node <dir>/dist/admin.js token create --label <l> --scope read|full [--origin hermes] [--label-filter k=v] --out <file>`, with `PASEO_HOME` set (or `--file`). Alternatively agentbox writes `{"label","scope","token":"<≥24 chars>"}` (or `"hash"`) into `$PASEO_HOME/paseo-mcp.managed.json` itself. hermes-ui gets `PASEO_MCP_URL=http://127.0.0.1:6790/mcp` and `PASEO_MCP_TOKEN=<token>`.
5. **Webhooks** are entries in `webhooks` of the managed file (`url`, `secret`, `signature: standard-webhooks|paseo|github`, `types`, `labels`, `onlyNeedsAttention`, `batchMs`, `headers`). Use `standard-webhooks` for Hermes `generic` routes. The secret stays in the file (mode 600).
6. **stdio for Hermes:** `node /opt/agentbox/vendor/paseo-mcp/<v>/paseo-mcp/dist/index.js` with `PASEO_MCP_CONFIG=/home/agentbox/.config/paseo-mcp/config.json` and `PASEO_HOME=/home/agentbox/.paseo`. `PASEO_HOME` only needs to be set if it differs from `~/.paseo`; the server reads the local credential there. Set `allowedRoots` to absolute paths.
7. The plugin writes `~/.local/bin/paseo-mcp` (a launcher pointing at the installed dir) and `$PASEO_HOME/paseo-mcp.json` (token last-used times, webhook pauses). The plugin dir itself can be read-only.
8. Event order: hook and push events can interleave, for example `permission_resolved` after `turn_ended`. Receivers sort by `seq` and dedupe by `id` or the `Paseo-Mcp-Delivery` header.
9. Paseo 0.17 needs `provider/model` for new agents. paseo-mcp now fills in the default model for a bare provider, so `defaultProvider: "claude"` works.
10. The npm name `paseo-mcp` belongs to someone else, so nothing was published to npm. Ship the GitHub release tarball.

## Release
- https://github.com/MaxGierlachowski/paseo-mcp/releases/tag/v0.5.0-rc.1 (pre-release, target `v1`)
- `paseo-mcp-0.5.0-rc.1.tgz`, sha256 `e53231b4e56c5825e1901765c59ab9733258a28a588b832f2e9a410a2faade8c`
- `paseo-mcp-0.5.0-rc.1.tgz.sha256`
