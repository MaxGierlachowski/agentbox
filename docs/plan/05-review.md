# 05 — Review and fact-check of 00-master-plan.md

Date: 2026-11-22. Method: desk check against real tools and sources on Max's Mac, without changing anything outside this folder and without running any login/auth command. Sources used:
- Hermes: `hermes … --help` (local install v0.23.2) and source in `~/.hermes/hermes-agent`, plus `git tag`/`git show v0.23.3:` in `~/Projects-private/hermes-agent` (upstream remote).
- Paseo: `Paseo.app` CLI 0.16.1 `--help`, and `npm pack @getpaseo/server@0.17.3` (config schema, `config.js`, `bootstrap.js`).
- iroh-bridge: shallow clone of `irohkit/iroh-bridge` at v0.6.4 (`crates/gateway/src/main.rs`, `packages/iroh-fetch`) and `gh release view`.
- KasmVNC: `unix/vncserver` and `kasmvnc_defaults.yaml` at tag v1.5.2.
- Other CLIs: `claude` 2.1.288, `gh`, `glab` 1.110.0.
- npm: `npm view`. Own repos: hermes-ui, paseo-mcp, paseo-multi-account, agentbox.

## Verdict
**Sound architecture, but it was not buildable as written.** After this pass it is mostly fixed and ready for the spike days. The topology holds up against the real APIs: one shared iroh-gateway, Caddy with forward_auth, an agentbox-owned systemd unit per service, a Hermes plugin for the bridge, and per-account `CLAUDE_CONFIG_DIR`. Every piece the plan depends on exists, sometimes under different names. Two kinds of problems turned up:
- **Wrong concrete facts:** version pins, CLI flags, config keys, env vars, file contracts.
- **A few false premises:** the `iroh-proxy` fixed key, Paseo `browserTools` as CDP, the npm name `paseo-mcp`, and `hermes gateway status` as a health check.

65+ targeted edits went into `00-master-plan.md`. The settled items are marked **[resolved 05]**, and §14.1 summarizes them. Only two `[verify]` markers remain (S6 KasmVNC and the §14 header). The other spikes are now narrowed to the parts that really need a VM.

## Fixed in the plan (with evidence)

| # | Plan said | Reality (evidence) | Fix |
|---|---|---|---|
| 1 | Hermes pin `v2026.9.24` | Tag exists, but it is a stale pre-semver date tag from 2026-09-24, and `git rev-list --count v2026.9.24..v0.23.3` = **33,543**. Upstream moved to semver: v0.22.0 on 2026-10-14 … **v0.23.3 on 2026-11-19 (newest stable)**. `hermes --version` prints `v0.23.2 (2026.9.24)` only because `hermes_cli/__init__.py` still has `__release_date__ = "2026.9.24"`. | C4, §4, risk row: pin `v0.23.3`; never pin `canary.*`/`rc.*`/`+canary`. |
| 2 | Install via `uv sync --frozen --no-dev` | Upstream installs through `setup-hermes.sh` → `pm` (pinned uv from `pm/lock.json`, managed Python). `.python-version` = 3.14. Core deps like `browser-harness==0.1.13` are gated on `python_version >= '3.14'` (Ubuntu 24.04 ships 3.12). Edge TTS, local whisper, Slack and Anthropic are **extras** (`edge-tts`, `stt-whisper`, `slack`, `anthropic`). | §4: `setup-hermes.sh --runtime-only` with CPython 3.14 and the extras listed; fallback is an explicit `uv sync --python 3.14 --extra …`. `python3-venv` dropped. |
| 3 | `hermes gateway status` exit 0 as a health check | `_cmd_status` never sets a non-zero exit; it prints "✗ Gateway is not running" and returns 0. | §5.3 health list: use `systemctl is-active` and `:8644/health`. |
| 4 | `ExecStart=hermes gateway run --replace` | Valid, and `--external-supervisor` exists for exactly this case: in-chat restarts and updates exit back to the external manager. | C5 and the unit now use `--replace --external-supervisor`. |
| 5 | Webhook platform bound to loopback (implicit) | `gateway/platforms/webhook.py`: `DEFAULT_HOST = None` binds **all interfaces** on :8644. Override with `platforms.webhook.extra.host`. | §12.1: set `platforms.webhook.extra.host: 127.0.0.1`. Without it, the e2e `ss` check would fail. |
| 6 | `hermes webhook …` [verify] | `hermes webhook subscribe <name> --prompt --events --secret --signature {generic,github,gitlab,linear} --deliver --route-profile …`. Profile routes are `/p/<profile>/webhooks/<name>`. Accepted deliveries return 202. | §12.7, and Caddy must allow `/p/*/webhooks/*`. |
| 7 | `hermes mcp add` / `config set` / `profile create` / `auth` [verify] | All exist. `mcp add --url | --command --args | --env | --auth oauth|header` has no header-value flag. `profile create --no-alias`; names must match `^[a-z0-9][a-z0-9_-]{0,63}$`. `auth add <provider> --type api-key|oauth [--no-browser]`; anthropic is OAuth-capable. | §8 screens 2, 6 and 8. Keys go through stdin, never through `--api-key` in argv. |
| 8 | Hermes `browser_connect` [verify] | The config key is `browser.cdp_url` (`config_defaults.py`), and env `BROWSER_CDP_URL` overrides it. `/browser connect` is only a slash command. | §11. |
| 9 | Slack manifest from the docs | `hermes slack manifest` generates it, including every slash command. | §12.5. |
| 10 | Bridge hook "or generic equivalent" [verify S5] | `pre_tool_call` supports `{"action":"modify","args":{…}}` (shallow merge) and gets `session_id`. `ctx.spawn_task(coro)` is a supervised background task. `ctx.inject_message(content, role, session_key=…)` is documented public API. `ctx.call_mcp(server, tool)` needs `plugins.entries.<id>.mcp_allowlist`. Hermes' MCP client sends **no `_meta`**, so the `_meta` fallback is dead. | §12.3 rewritten; S5 narrowed. |
| 11 | Bridge install via tarball + `hermes plugins enable` [verify] | `hermes plugins install` only takes a catalog name, Git URL or owner/repo. The documented local path is a drop-in dir in `~/.hermes/plugins/` plus `plugins enable`. | §4 row. |
| 12 | Paseo 0.15.x everywhere | npm `latest` is **0.17.3** (2026-11-22; 0.17.0 came out 2026-11-21). The Mac runs 0.16.1, paseo-mcp is on `^0.15.3`, multi-account on 0.12.0. | C6, §4, §13, WPs: 0.17.x, with 0.16.2 as fallback (decision below). |
| 13 | Paseo keys `mcp.injectIntoAgents`, `browserTools.enabled`, relay off | The schema (`persisted-config.d.ts`) uses `daemon.mcp.injectIntoAgents`, `daemon.browserTools.enabled`, `daemon.relay.enabled`, `daemon.listen` and `features.webUi.enabled` (default false). Env vars: `PASEO_LISTEN`, `PASEO_RELAY_ENABLED`, `PASEO_WEB_UI_ENABLED`. `/api/health` exists. | §5.3, §12.2. |
| 14 | Paseo `browserTools` "points at the same CDP" | There is no CDP setting. The daemon routes browser tools through `BrowserToolsBroker` to a connected Paseo client. | §11/§12.2: disable it on the box; agents use browser-harness/`agentbox-browser`. |
| 15 | `paseo plugin install <dir>` [verify S3] | Verified: the source can be a registry slug, host directory, Git URL or `npm:`. | §4. |
| 16 | Stdio paseo-mcp env `PASEO_DAEMON_URL` | Doesn't exist. paseo-mcp reads `PASEO_MCP_CONFIG` (file with `daemonUrl`, `allowedRoots`, `accounts`, `originLabel`, `metaLabels`, `events`), the same way the Mac's Hermes config does. hermes-ui `PASEO_MCP_URL`/`PASEO_MCP_TOKEN` are real. | §12.2. |
| 17 | npm `paseo-mcp@0.5.0` | **The name `paseo-mcp` on npm belongs to another maintainer** (v0.1.0). | §4/§13/WP-PM-1: tarball, or a scoped npm package. |
| 18 | Multi-account registration via `claude-accounts.json` [verify S4] | Accounts are **Paseo providers**: `agents.providers.<id> = {extends:"claude", label, enabled, env:{CLAUDE_CONFIG_DIR}}` (`server/accounts.ts`). `claude-accounts.json` only holds `activeAccountId`, `agents`, `pinned`, `identities`. The plugin already has a `claude auth login` URL+code flow (`server/login.ts`). | C8, §8 screen 2, §13, and the e2e jq check (old `.accounts|length` would always fail). |
| 19 | Claude login "PTY `claude` login" | The real subcommand is `claude auth login [--claudeai|--console]`, plus `claude auth status`. | C8, §8, S9. |
| 20 | `iroh-proxy` = `agentbox connect` with a fixed key | `iroh-proxy` flags are `--port --host --allow-host --allow-origin --relay-url --relay-token --connect-timeout`, with **no key option**, so the S1 fallback is triggered. The library has `secretKey`/`persistIdentity`. A native napi engine (linux x64/arm64, macOS, win x64) gives direct UDP; WASM is relay-only. | C1, C12, C17, §3, §4, §11, S1, S8, WP-AB-4, §16. |
| 21 | iroh-gateway behaviour [verify S1] | Verified in `main.rs`: `BACKEND_URL`, `IROH_ROUTES` (host from `x-iroh-host`), `IROH_ALLOW_CLIENTS` (empty = anyone), `IROH_ALLOW_PATHS` (others 403), `IROH_CONFIG_FILE` re-read on SIGHUP, allow list re-checked per stream, `X-Iroh-Remote-Id` injected and spoof-stripped, admin `/healthz` `/readyz` `/status` `/metrics` (loopback only), stdout `IROH_ENDPOINT_ID=<id>`. `/healthz` returns **503 when offline**. Release assets `iroh-gateway-v0.6.4-<arch>-unknown-linux-musl.tar.gz(.sha256)` exist. | §6.2, §5.3 health notes. |
| 22 | KasmVNC 1.4.x, `kasmvncserver_noble_…deb`, `-disableBasicAuth` [verify] | Latest is **1.5.2**, asset `kasmvncserver_ubuntu_noble_1.5.2_{amd64,arm64}.deb`. Wrapper options are `-fg -interface -websocketPort -select-de -config …`, and other args (`-DisableBasicAuth`, an Xvnc parameter) pass through. Defaults: `require_ssl: true` with the snakeoil cert (needs `ssl-cert` group), interface 0.0.0.0. The wrapper is **interactive on first start** (kasmpasswd user, DE, write permission). | §4, §5.3 unit, S6. |
| 23 | glab `auth login --web` as a device flow | In glab 1.110 `--web` is browser/OAuth (localhost callback). **`--device`** is the headless device flow and needs GitLab ≥ 17.9. | §8 screen 6, S9. |
| 24 | gh device flow then `gh ssh-key add` | `gh ssh-key add` needs the `admin:public_key` scope, which is not in the default scopes. Also, `--git-protocol ssh` would prompt for key upload. | `-s admin:public_key --skip-ssh-key`. |
| 25 | Base bundle includes `user-story-manager`, `browser-harness` skill | `user-story-manager` is not in upstream Hermes (it's a personal skill on the Mac). `browser-harness` is a Python package, not a skill. The other 19 skill names all exist under `skills/` at `v0.23.3` (checked with `git ls-tree`). | §9.3. |
| 26 | anthropics/skills all installable | `docx/pdf/pptx/xlsx` are source-available, not OSS. | §9.1 excludes them from auto-install. |
| 27 | Caddy 2.10.x, uv 0.9.x | Latest Caddy is 2.11.9. uv 0.13.9 is only needed if `pm` is bypassed. | §4. |
| 28 | hermes-ui "merge PR #9 → #10" | #9 (mobile store readiness) and #10 (universal/Tauri spike) are the only open PRs, and both are app work. | §13: don't merge for v1. |
| 29 | e2e script | The idempotency string contradicted the AC (`no changes` vs `noop`). The CDP exposure probe used https on a plain-http port, so it could never fail. The `ss` check skipped UDP. The multi-account jq was wrong. | §16 fixed. |
| 30 | `packages/infra/secrets` | The real path is `packages/infra/src/secrets`. | §7. |

These were checked and are correct as written: Node 24 is still LTS (24.22.3 "Krypton"); hermes-ui `bin/hermes-ui.mjs serve`, `HERMES_UI_PORT` 8787, `/api/health`, `HERMES_UI_REMOTE=off`; hermes-ui uses `gateway.sock` plus WS `session.resume`/`prompt.submit`; the agentbox paths to delete in §13 exist and `Listener = "tailscale" | "local"` is in `server/auth.ts`; the MCP Registry `v0`/`v0.1` endpoints answer 200; the EFF 6-word OTP is ≈77.5 bits; the plan itself has no employer references (the only hits are in input docs 01/02, which describe the Mac).

## Open blockers (need Max or a VM)
1. **`get.agentbox.dev` is probably not Max's domain.** `agentbox.dev` (registered 2014) resolves to AWS Global Accelerator IPs and serves a JS redirect to `/lander`, which is the typical parking page. The GitHub account `agentbox` is also taken. The installer URL, the plan text and `agentbox/apps/agentbox/src/config.ts` all assume this domain.
2. **Paseo minor churn.** 0.17.0 → 0.17.3 shipped within ~30 h (as of 2026-11-22). Both plugins must be ported from 0.12/0.15, and S3 has to prove they load on Linux.
3. **Hermes install location (S2).** `pm` keeps the venv under `HERMES_HOME/installs/<hash>/…` on the Mac. That breaks the "root-owned, read-only `/opt/agentbox/vendor/hermes-agent/<tag>`" model and affects backups and updates. Needs a VM run.
4. **Bridge session binding (S5).** It is unproven that `bound_session_key()` is set in the tool-call thread and that `inject_message` resumes a Hermes-UI (`local`) session. If either fails, the fallback is the sidecar over the gateway WS.
5. **KasmVNC non-interactive start (S6).** Pre-seeding kasmpasswd, DE and yaml, or running `Xvnc` + `openbox` directly, is unproven, and so is the `/browser/` path prefix.
6. **GitHub remote MCP with a `gh` OAuth token** is untested. The fallback is the stdio `github-mcp-server` with `gh auth token`.
7. **Timeline.** About 25 WPs plus 10 spikes in 1–2 weeks needs strict use of the §17 cut order. Phone stream (S7) and webhooks `domain` mode should be treated as already cut.

## Further observations (not changed, worth a look)
- `:8081` uid firewall: add the `ip6tables` equivalent, or bind Caddy :8081 to `127.0.0.1` only.
- Agents run as uid `agentbox`, the same uid as the config server, SQLite DB, age identity and sudo helper. That makes "no general sudo" weaker than it sounds. It is documented as single-tenant; it's the first thing to fix with a separate agent uid in v1.1.
- Chrome `--remote-debugging-address` only matters for headless. Headful Chrome binds CDP to 127.0.0.1 anyway, so it is harmless.
- Disable unattended Hermes plugin updates (`plugins.auto_apply`) so manifest pins hold. This was added to §12.1.

## Spike status after this review
| Spike | Status |
|---|---|
| S1 iroh | API facts settled, fallback (own proxy with `secretKey`) taken. VM test of WS/SSE/cookies still open. |
| S2 Hermes | All CLI verbs/flags confirmed (v0.23.2 local). Open: `pm` install on Linux, extras, venv location, non-interactive auth. |
| S3 Paseo | Keys, `plugin install <dir>`, `/api/health` confirmed. Open: version choice, plugins on Linux. |
| S4 multi-account | Registration contract confirmed. Open: two real accounts on Linux, usage and switching. |
| S5 bridge | Plugin API confirmed. Open: session-key binding and resume of UI sessions. |
| S6 KasmVNC | Flags and defaults confirmed. Open: non-interactive start and path prefix. |
| S7, S8, S10 | Unchanged (S8 now: can Bun embed the iroh-fetch napi addon). |
| S9 | Flags corrected. Open: PTY parsing. |

## Decisions for Max
1. **Paseo pin:** 0.17.x (newest, but 3 patches in 2 days) or 0.16.2 (closest to the Mac's 0.16.1).
2. **Domain:** buy or confirm `agentbox.dev`, or pick another name/domain. A GitHub Pages fallback such as `<owner>.github.io/agentbox/install.sh` works either way.
3. **paseo-mcp distribution:** a scoped npm name (which scope?) or GitHub Release tarballs only.
4. **`agentbox connect` runtime:** if S8 fails, a Node-based `npx` helper or a separate small binary.
5. **`user-story-manager`:** drop it, or rewrite a generic version for the catalog.
