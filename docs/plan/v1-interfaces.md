# v1 cross-repo interfaces (binding for all work packages)

Date: 2026-11-22. Derived from `00-master-plan.md`; where this file is more specific, this file wins.
Private open-source project of Max Gierlachowski. No employer names, accounts or internal systems anywhere.

## Pins
| Component | Version |
|---|---|
| Paseo (`@getpaseo/cli`, `@getpaseo/client`, `@getpaseo/plugin`, `@getpaseo/server`) | **0.17.3** exact (fallback 0.16.2 only if 0.17 breaks) |
| Hermes agent | upstream NousResearch **v0.23.3** |
| Node.js | 24.22.3 |
| iroh-gateway / iroh-fetch | 0.6.4 |
| Caddy | 2.11.9 |
| KasmVNC | 1.5.2 |
| Claude Code `@anthropic-ai/claude-code` | 2.1.330 |
| gh | 2.105.0 · glab 1.131.0 |

## Host layout (Ubuntu 24.04, x64 + arm64)
- Service user `agentbox` (uid 10001), `HOME=/home/agentbox`. Edge user `agentbox-edge` (system, no shell).
- `HERMES_HOME=/home/agentbox/.hermes`, `PASEO_HOME=/home/agentbox/.paseo`.
- Claude accounts: `/home/agentbox/.claude-accounts/<slug>/` (= `CLAUDE_CONFIG_DIR`, `.credentials.json` on Linux).
- Vendored components: `/opt/agentbox/vendor/<component>/<version>/`; node at `/opt/agentbox/vendor/node/24.22.3/bin/node`, wrappers in `/usr/local/bin` (`node`, `npm`, `npx`, `paseo`, `claude`, `hermes`).
- Repos: `/home/agentbox/work/<host>/<owner>/<repo>`.
- No component may write outside its home/state dirs at runtime; no component may self-update (pins hold).

## Ports (all bind 127.0.0.1 only, IPv6 never wildcard)
| Port | Service |
|---|---|
| 7777 | agentbox config server (API + config UI) |
| 8080 | Caddy local listener (SSH tunnel / `agentbox connect` target) |
| 8081 | Caddy iroh ingress (only the gateway's uid may connect) |
| 8443 | Caddy LAN TLS listener (**the only non-loopback port**, LAN mode only) |
| 8787 | hermes-ui |
| 6767 | Paseo daemon (`/api/health`, WS `/ws`) |
| 6901 | KasmVNC web client + websocket |
| 9333 | Chrome CDP (never proxied) |
| 8090 | iroh-gateway admin |
| 8644 | Hermes webhook platform |

## Release artifacts (all GitHub, repo owner `MaxGierlachowski`)
Each repo has a script that builds a **self-contained** tarball (no network/npm install needed at install time, prod deps vendored, platform-independent unless stated) plus a `.sha256` file:

| Repo | Build command (in repo) | Asset | Top-level dir in tarball | Installed by agentbox via |
|---|---|---|---|---|
| paseo-mcp | `npm run release:tarball` | `paseo-mcp-<ver>.tgz` | `paseo-mcp/` | `paseo plugin install <dir>` **and** stdio `node <dir>/<bin>` for Hermes |
| paseo-multi-account | `npm run release:tarball` | `paseo-multi-account-<ver>.tgz` | `paseo-multi-account/` | `paseo plugin install <dir>` |
| hermes-paseo-bridge | `./scripts/release-tarball.sh` | `hermes-paseo-bridge-<ver>.tar.gz` | `hermes-paseo-bridge/` | copy to `$HERMES_HOME/plugins/hermes-paseo-bridge` + `hermes plugins enable hermes-paseo-bridge` |
| hermes-ui | `npm run release:tarball` | `hermes-ui-<ver>.tgz` | `hermes-ui/` (bin/, src/, server.mjs, shared/, web/dist, node_modules prod) | `node hermes-ui/bin/hermes-ui.mjs serve` |

Tarballs are written to `dist/` in the repo, filename versions from package.json/pyproject. Only **agentbox** and **paseo-mcp** may publish GitHub *pre-releases* for now; the other tarballs are attached to the agentbox pre-release by the agentbox release script until Max publishes their own releases.

## hermes-ui ↔ agentbox
- Caddy routes `/hermes/*` → `127.0.0.1:8787` with the **prefix stripped** (`handle_path`). Hermes UI must still emit URLs under `/hermes/` (`HERMES_UI_BASE_PATH=/hermes`): HTML asset URLs, API calls, SSE/WS, service worker scope, manifest.
- `HERMES_UI_AUTH=proxy` + `HERMES_UI_PROXY_SECRET=<secret>`: a request is authorized iff header `X-Agentbox-Proxy-Secret` equals the secret (timing-safe) **and** `X-Agentbox-User` is non-empty. Otherwise 401. Token/device-cookie/login flows and the built-in iroh gateway are off in proxy mode (`HERMES_UI_REMOTE=off`).
- `HERMES_UI_PAIRING_URL` (e.g. `/devices?pair=1`): in proxy mode the "Pair device"/remote dialog shows a button that opens this URL instead of minting codes itself.
- `?compose=<urlencoded text>` on the app URL prefills the composer of a new chat (not sent automatically).
- PWA over iroh (phone): pairing link `<ui_url>/#iroh=<endpointId>&pair=<code>&base=/hermes[&relay=<url>]`. The PWA uses a persistent iroh identity, calls `POST {base}/api/pair/redeem {code,name}` through iroh-fetch (agentbox's Caddy maps that path to agentbox's device registry and returns `{ok:true}`), then prefixes every API call with `{base}`. Without `base`, behaviour is unchanged (standalone hermes-ui).
- Health: `GET /api/health` (unauthenticated, loopback) keeps working.
- Env used by agentbox's unit: `HERMES_UI_PORT=8787 HERMES_UI_HOST=127.0.0.1 HERMES_UI_REMOTE=off HERMES_UI_AUTH=proxy HERMES_UI_PROXY_SECRET HERMES_UI_BASE_PATH=/hermes HERMES_UI_DATA_DIR=/var/lib/agentbox/hermes-ui HERMES_UI_PAIRING_URL=/devices?pair=1 PASEO_MCP_URL PASEO_MCP_TOKEN HERMES_HOME`.
- Remove remote modes `tailscale-funnel`, `tailscale-serve`, `cloudflare`; keep `off | iroh`.

## Paseo daemon (agentbox-paseo.service)
`paseo daemon run` with `PASEO_HOME=/home/agentbox/.paseo`, config: `daemon.listen=127.0.0.1:6767`, `daemon.relay.enabled=false`, `features.webUi.enabled=false`, `daemon.mcp.injectIntoAgents=true`, `daemon.browserTools.enabled=false`.
Claude accounts = provider entries in `$PASEO_HOME/config.json`: `agents.providers.<slug> = {extends:"claude", label, enabled, env:{CLAUDE_CONFIG_DIR:"/home/agentbox/.claude-accounts/<slug>"}}`. Login per account: `CLAUDE_CONFIG_DIR=… claude auth login --claudeai` (URL + paste-code, driven by agentbox in a PTY), check with `claude auth status`.

## paseo-mcp
- Plugin installed into Paseo (HTTP endpoint + events/webhooks). README section "Headless Linux / agentbox" must state: the plugin's HTTP MCP URL on the box, how read/write tokens are created non-interactively (CLI command or file), and the webhook/event config.
- Stdio for Hermes: `node /opt/agentbox/vendor/paseo-mcp/<v>/paseo-mcp/<bin>` with `PASEO_MCP_CONFIG=/home/agentbox/.config/paseo-mcp/config.json` (`daemonUrl: ws://127.0.0.1:6767/ws`, `allowedRoots: ["/home/agentbox/work"]`, `originLabel: "hermes"`, `accounts`, `defaultAccount`, `events`).

## hermes-paseo-bridge
- Hermes plugin id `hermes-paseo-bridge`. Receives Paseo agent events (paseo-mcp webhook to a **loopback** receiver, or long-poll) and injects a follow-up into the Hermes session that started the agent. Config via plugin config in `$HERMES_HOME/config.yaml` (`plugins.entries.hermes-paseo-bridge.*`) and/or env; README documents every key agentbox must render (receiver port, webhook secret, paseo-mcp URL/token).

## Rules for every agent
- Never run login/auth commands with Max's accounts; never touch `~/.hermes`, `~/.paseo`, `~/.claude*` on the Mac. Use temp HOMEs or Docker for experiments.
- Never print or commit secrets. No employer references.
- Work on branch `v1`, small commits, lint+tests green, push branch, open a **draft** PR against `main`. Never merge, never force-push `main`.
