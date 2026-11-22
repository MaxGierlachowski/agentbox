# 00 — Agentbox v1 master plan

Status: decision-complete draft, 2026-11-22. Fact-checked against real CLIs/sources the same day; findings and evidence in `05-review.md` (items marked **[resolved 05]** were settled there). Supersedes the topology parts of `agentbox/docs/implementation-plan.md` (§1, §3, §9, §10, §12, §12a) and ADR 0004–0007.
Inputs: `../agentbox-brief.md`, `01-benchmark-mac-setup.md`, `02-repo-audit.md`, `03-ux-and-catalog.md`, `04-browser-and-runtime.md`.
Scope: private open-source project. No employer names or systems anywhere in code, docs, catalog or examples.

**v1 in one sentence:** on a clean Ubuntu 24.04 x64 VM, `curl -fsSL https://get.agentbox.dev | sh && sudo agentbox up` installs and wires Hermes, Hermes UI, Paseo (+ paseo-mcp, paseo-multi-account, hermes-paseo-bridge), a streamed Chrome and one iroh gateway. The owner claims the box with a one-time code, finishes a guided onboarding in under 10 minutes and lands in Hermes UI with a first task ready to send.

Everything still marked **[verify]** is resolved by a spike in §14 before the dependent WP starts (§14.1 lists what the desk review already settled). Each spike has a fallback that is already decided, so no spike outcome blocks the plan.

---

## 1. Fixed decisions (from Max) and the benchmark

- Remove **Plane, MetaMCP, CloudCLI and Tailscale** everywhere: code, ADRs, docs, hermes-ui remote modes.
- **Remote access only via iroh.** The only exceptions are the first-access paths (LAN HTTPS or SSH tunnel, §6.1) and the opt-in webhook ingress (§12.7). Webhook ingress serves only `/webhooks/*` and accepts only signed requests. It is not UI access.
- **Two UIs.** The *agentbox config UI* handles setup, extending the box and the overview. *Hermes UI* is for daily work and phone pairing.
- **Onboarding order:** role first → preconfigured skills/MCPs → autocomplete library → pre-filled SOUL → guided CLI auth → SSH keys → repos → AI-generated agent profiles → streamed Chrome for site logins → hand-off to Hermes UI.
- **Benchmark:** all 14 items in `01 §4` work on the Proxmox x64 VM after install + `agentbox up` + onboarding. The mapping is in §12, and the test is in §16.
- **Timeline:** soft launch in 1–2 weeks. v1 covers the self-host path only. Cloud provisioning only gets design hooks (§19).
- **Keep from agentbox:** the Bun single binary with embedded UI, Hono + oRPC (contract-first, SSE with `lastEventId` resume), SQLite (bun:sqlite + Drizzle), the age secrets store, the provider `detect/plan/apply/verify` engine with run events and redaction, `packages/ui`, and the monorepo tooling.

---

## 2. Conflict resolutions

| # | Topic | Conflict | Decision | Why |
|---|---|---|---|---|
| C1 | iroh gateway | 04 proposes a new Rust `agentbox-gw` with raw-stream ALPN and its own `agentbox connect`. hermes-ui already ships `iroh-gateway` (irohkit/iroh-bridge) with pairing and an allow-list. | **Use one shared `iroh-gateway` (iroh-bridge, pinned v0.6.4), owned by agentbox.** hermes-ui runs with `HERMES_UI_REMOTE=off` and does not spawn its own gateway. **No new Rust daemon.** | iroh-bridge already does HTTP, **WebSocket and SSE**, host/path routing (`IROH_ROUTES`), `IROH_ALLOW_CLIENTS` with SIGHUP hot reload, rate limits, an admin `/healthz`, a systemd unit, and `iroh-proxy`, a local-port client. Everything 04 asked for exists, except one thing: the `iroh-proxy` CLI (iroh-fetch 0.6.4) has **no option for a fixed client key** (flags: `--port --host --allow-host --allow-origin --relay-url --relay-token --connect-timeout`), so `agentbox connect` is our own ~50-line local proxy around `createIrohFetch({ endpointId, secretKey, engine: "native" })` [resolved 05]. |
| C2 | Device list | hermes-ui has `devices.json`. 04 has a separate `devices.json`. | **A single device registry in the agentbox SQLite DB (`devices` table)**, rendered to the gateway's `IROH_CONFIG_FILE`. hermes-ui gets an auth mode `proxy` and delegates pairing to the agentbox API. | One QR, one allow-list, one revoke. This is the "fold" option that 04 also recommends. |
| C3 | Agentbox binary language | 04: Rust or Go static binary. 02: keep Bun. | **Bun single binary** (`bun build --compile`, linux-x64 and linux-arm64), signed with minisign. | Existing reusable core. The only native piece we needed (iroh) is covered by iroh-gateway. |
| C4 | Hermes source | Fork vs upstream. | **Upstream NousResearch release tag, pinned** (start at **`v0.23.3`** = newest stable, tagged 2026-11-19; bump to the newest `vX.Y.Z` at WP start, S2) [resolved 05]. Upstream moved from date tags to semver in Oct 2026: `v2026.9.24` is a stale pre-semver tag (2026-09-24, ~33.5k commits behind `v0.23.3`), and `hermes --version` printing "(2026.9.24)" is only a leftover `__release_date__` label. Never pin `canary.*`, `rc.*`, `abandoned-rc.*` or `+canary` tags. The fork is not used, and every customization lives in plugins, skills and config. | The fork is 0 commits ahead and 6700 behind. Hermes policy is "plugins never touch core". |
| C5 | Hermes gateway service | 02: "call `hermes gateway install`". 04: own system units. | **Agentbox-owned system unit `agentbox-hermes.service` with `ExecStart=hermes gateway run --replace --external-supervisor`**, running as user `agentbox`. Do not use `hermes gateway install`. | `gateway install` writes user units/linger and its own conventions. One `agentbox.target` with uniform restart and hardening is simpler. `gateway run` is upstream's own foreground entry point (`hermes_cli/gateway.py`). `--external-supervisor` (verified flag) makes in-chat restarts/updates exit back to systemd instead of spawning a detached replacement. One gateway serves all profiles (upstream "ONE host gateway" multiplexer). |
| C6 | Paseo version skew | multi-account is on `@getpaseo/*` 0.12.0 (requirement `>=0.13.0`), paseo-mcp on `^0.15.3`. Max's Mac runs 0.16.1; npm `latest` is **0.17.3** (published 2026-11-22; 0.17.0 was 2026-11-21) [resolved 05]. | **Pin one Paseo version for the whole stack: `@getpaseo/cli`, `@getpaseo/client`, `@getpaseo/plugin` (and the transitive `@getpaseo/server`) = 0.17.x**, exact patch chosen in S3; if 0.17 is still churning at S3, fall back to 0.16.2 (last 0.16 patch, closest to the known-good Mac). Set `requirements.paseo` to `>=0.17.0 <0.18` (or `>=0.16.0 <0.17`). | A single matrix to test. 0.15 is already two minors behind. |
| C7 | multi-account credentials | macOS Keychain vs file. | **Linux uses `<CLAUDE_CONFIG_DIR>/.credentials.json` only.** The `darwin` branch stays. Add a Linux unit test and an e2e test in S4. | The code already falls back to the file on non-darwin. It only needs verification and tests. |
| C8 | Claude login | 04: `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`. multi-account needs one `CLAUDE_CONFIG_DIR` per account with `.credentials.json`. | **Per account: a PTY-driven `claude auth login --claudeai` with `CLAUDE_CONFIG_DIR=/home/agentbox/.claude-accounts/<slug>`** (URL + paste-code flow; verify with `claude auth status`). multi-account already implements exactly this flow (`server/login.ts`: runs `claude auth login`, shows the manual URL, writes the code to stdin), so agentbox may call it instead of its own PTY parser. `setup-token` is the fallback when an account doesn't need usage display. An API key is an alternative. | Usage and switching in multi-account read the credentials file. A single env token can't be pinned per agent. |
| C9 | Single origin: path prefix vs per-port | 04 wants `/`, `/hermes/`, `/browser/`, `/paseo/` behind Caddy. Base-path support is unknown. | **Path prefix.** Caddy serves `/` (config UI), `/hermes/` (Hermes UI) and `/browser/` (KasmVNC). **Paseo's own UI is not exposed in v1.** We own hermes-ui, so WP-HUI-2 adds `HERMES_UI_BASE_PATH`. Fallback is per-port only for KasmVNC (S6): `/browser/` → a second Caddy site on `127.0.0.1:8082`, reached through gateway `IROH_ROUTES` host routing. | One cookie, one gateway upstream, one tunnel. |
| C10 | First access | 03: `https://host:port/setup?t=…`. 04: no public ports, SSH tunnel, `--listen-lan` opt-in. | **`agentbox up` auto-detects.** If the VM has only RFC1918/ULA addresses (the Proxmox case), it enables a LAN listener `https://<lan-ip>:8443` (Caddy `tls internal`, cert fingerprint printed). If it has a public IP, the box binds loopback only and prints the SSH tunnel command. Both print the OTP URL. Override with `--listen lan|local`. | Zero manual work for the main v1 target without exposing public hosts. |
| C11 | OTP format and lifetime | 03: 30 min, 6 words. 04: 128-bit, 24 h. | **6 words from the EFF large wordlist (~77 bits), single use, 60 min, rate-limited to 5 tries/min/IP, `/setup` returns 404 once an owner exists.** `sudo agentbox otp` reissues it. | Typable from a console screenshot and safe enough with rate limits. |
| C12 | Owner credential | 03: passkey first. 04: passphrase or passkey. | **Password (argon2id) is mandatory. A passkey is optional** and only offered on secure origins (localhost via SSH tunnel or `agentbox connect`). | WebAuthn fails on a self-signed LAN cert. A password always works. |
| C13 | Secrets at rest | 04: plaintext `/etc/agentbox/secrets.env`. agentbox: age store with sealed start/unlock. | **The age store is the source of truth.** v1 auto-unlocks with an identity file (`/var/lib/agentbox/secrets/identity`, 0600). Per-service env files are rendered to tmpfs `/run/agentbox/env/<unit>.env` (0600) by `ExecStartPre=agentbox secrets render <unit>`. Passphrase sealing is v2. | Encrypted at rest, unattended reboots work, and the existing code is reused. |
| C14 | Workloads | Old plan: a Docker workspace container per box. | **No containers in v1.** Hermes, Paseo agents and Chrome run natively as user `agentbox`. Docker is offered only as an optional catalog CLI. | Paseo and Hermes expect a host filesystem, CDP lives on loopback, and this saves a week. |
| C15 | Install root | Old plan: `/srv/agentbox`, port 7777. 04: `/opt` + `/var/lib`. | **`/opt/agentbox` (release + vendored components), `/etc/agentbox` (config), `/var/lib/agentbox` (agentbox state), `/home/agentbox` (`HERMES_HOME`, `PASEO_HOME`, CLI creds, repos).** The config server stays on `127.0.0.1:7777`. | Hermes and Paseo keep their default homes, so upstream docs and skills apply unchanged. |
| C16 | Catalog | 03: cloud ingest pipeline, Postgres, signed snapshots, PulseMCP/Smithery/Glama. | **v1 sources: curated bundled YAML + official MCP Registry (live, cached) + anthropics/skills index (built at release time) + Hermes' own `optional-skills`/`optional-mcps`.** No paid partners and no cloud pipeline. | Pragmatic for 1–2 weeks. The `CatalogItem` schema from 03 is kept so the snapshot pipeline can come later. |
| C17 | Remote browser on phone | 04: KasmVNC via a WebView in the native app. The app is unmerged and not in any store. | **Laptop:** full KasmVNC through `agentbox connect` (local proxy on native iroh-fetch, fixed key). **Phone:** KasmVNC client inside the Hermes UI PWA over iroh-fetch WebSocket (spike S7). Fallback: the phone uses the LAN URL. A CDP-screencast lite view comes in v1.1. **The native mobile app is out of scope.** | The stores can't be shipped in 2 weeks. The PWA already speaks iroh. |
| C18 | Paseo ↔ Hermes bridge | The bridge repo is empty. Mac uses launchd `paseo_watch` + an ngrok webhook. | **hermes-paseo-bridge = a Python Hermes plugin** (standalone repo, installed into `~/.hermes/plugins/`). It consumes paseo-mcp events and continues the originating Hermes session (§12.3). No ngrok: the event path is loopback only. | Matches the repo README and Hermes plugin policy. |
| C19 | Webhook ingress | Mac uses ngrok. 01 suggests public IP/Caddy or a Cloudflare tunnel. | **Opt-in `agentbox webhooks expose`** with modes `cloudflared` (quick tunnel, no account) or `domain <fqdn>` (Caddy ACME on :443, only `/webhooks/*`). It is off by default. | Must-have #11 without making it UI access. |

---

## 3. Architecture

```
                 laptop                           phone                         (v2: SaaS edge)
     ┌───────────────────────────┐   ┌─────────────────────────────┐
     │ browser → http://localhost:8080  │ Hermes UI PWA (static, Pages│
     │   ▲ agentbox connect         │   │ or self-host) iroh-fetch WASM│
     │   │ (iroh-fetch, fixed key)  │   │ fetch/WS/SSE  → /hermes/api  │
     └───┼──────────────────────────┘   └──────────────┬──────────────┘
         │ QUIC (direct or n0 relay), E2E encrypted     │
═════════╪══════════════════════════════════════════════╪══════════════════ VM (Ubuntu 24.04)
         ▼                                              ▼
   ┌──────────────────────────────────────────────────────────┐
   │ agentbox-iroh.service  iroh-gateway v0.6.4 (user agentbox-edge)
   │  key /var/lib/agentbox/iroh/gateway.key   IROH_ALLOW_CLIENTS ← devices table
   │  BACKEND_URL=http://127.0.0.1:8081   admin 127.0.0.1:8090 (/healthz)
   └───────────────┬──────────────────────────────────────────┘
                   ▼   (iptables: only uid agentbox-edge may connect to :8081)
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │ agentbox-caddy.service (user agentbox-edge)                                   │
   │  :8080 local   (cookie auth)      :8081 iroh ingress (trusts X-Iroh-Remote-Id)│
   │  :8443 LAN TLS (cond., cookie)    :8083 / :443 webhooks only (opt-in)         │
   │  forward_auth → agentbox /api/auth/check  (sets X-Agentbox-User, strips spoofed headers)
   │  /            → 127.0.0.1:7777  agentbox config UI + API (oRPC)               │
   │  /hermes/*    → 127.0.0.1:8787  Hermes UI (HERMES_UI_BASE_PATH=/hermes)       │
   │  /browser/*   → 127.0.0.1:6901  KasmVNC web client + websockify               │
   │  /webhooks/*  → 127.0.0.1:8644  Hermes webhook platform (only on :443/tunnel) │
   └──────────────────────────────────────────────────────────────────────────────┘
        │                     │                          │
        ▼                     ▼                          ▼
 agentbox-config        agentbox-hermes-ui        agentbox-kasmvnc (Xvnc :1, openbox)
 (Bun binary, SQLite,   (Node 24, hermes-ui)        └ agentbox-chrome (Chrome x64 / Chromium arm64,
  age secrets, PTY         │ ws gateway.sock            profile /var/lib/agentbox/chrome-profile,
  device-flows, catalog,   │ paseo-mcp HTTP              CDP 127.0.0.1:9333 — never proxied)
  sudo helper)             ▼                                       ▲ attach only
                    agentbox-hermes  (hermes gateway run; HERMES_HOME=/home/agentbox/.hermes)
                     ├ profiles default + generated, SOUL.md, skills, cron, Slack Socket Mode
                     ├ MCP: paseo (stdio paseo-mcp), gmail/slack (OAuth remote), catalog MCPs
                     ├ plugin hermes-paseo-bridge ◄── paseo-mcp events (loopback)
                     ├ browser-harness / browser tools → cdp_url http://127.0.0.1:9333
                     └ webhook platform 127.0.0.1:8644, TTS edge, STT local whisper (ffmpeg)
                    agentbox-paseo  (paseo daemon run, 127.0.0.1:6767, relay off, web UI off)
                     ├ plugin paseo-mcp (events + webhooks + Streamable HTTP)
                     ├ plugin paseo-multi-account (accounts = claude providers in config.json, CLAUDE_CONFIG_DIR each)
                     └ Claude Code / Codex agents in git worktrees under /home/agentbox/work
```

Request trust rules (enforced in WP-AB-3/WP-AB-4):
- **:8080 / :8443:** Caddy deletes inbound `X-Iroh-Remote-Id`, `X-Agentbox-*`. Auth = `agentbox_session` cookie (HttpOnly, SameSite=Strict, Secure on :8443).
- **:8081:** only reachable by the gateway process (`iptables -A OUTPUT -o lo -p tcp --dport 8081 -m owner ! --uid-owner agentbox-edge -j REJECT`, installed by `agentbox up`, persisted via a `agentbox-firewall.service` oneshot). `X-Iroh-Remote-Id` is trusted here and looked up in `devices`. Unknown ids may only call `/api/devices/pair/*`.
- **Upstream apps** (Hermes UI) trust `X-Agentbox-User` only when accompanied by `X-Agentbox-Proxy-Secret` (random, rendered into both Caddy and hermes-ui env). They also stay bound to loopback.
- **CDP 9333, Paseo 6767, Hermes webhook 8644, KasmVNC 6901** bind 127.0.0.1 only. 9333 and 6767 are never routed by Caddy.

---

## 4. Components and pinned install method

All versions live in one manifest, `agentbox/manifest/components.yaml`, embedded in the release. Each entry has `version`, `url` per arch, `sha256` and `install` steps. Renovate bumps it and CI runs the e2e VM test before merge. Nothing installs "latest" at runtime.

| Component | Pin (initial) | Install method | Location |
|---|---|---|---|
| agentbox | v0.1.0 | `get.agentbox.dev` → `install.sh` downloads `agentbox-linux-{x64,arm64}` + `.minisig` from GitHub Releases, verifies against the pinned pubkey | `/opt/agentbox/releases/<v>/agentbox`, symlink `/usr/local/bin/agentbox` |
| Node.js | 24.x LTS (exact patch in manifest) | official nodejs.org tarball + SHASUMS256 | `/opt/agentbox/vendor/node/<v>` |
| uv | only if S2 bypasses Hermes' `pm` (then 0.13.x, current 0.13.9) | astral GitHub release tarball + sha256 | `/opt/agentbox/vendor/uv/<v>` |
| Hermes agent | upstream **`v0.23.3`** → newest stable `vX.Y.Z` at WP start (S2) | `git clone --depth 1 --branch <tag> https://github.com/NousResearch/hermes-agent` → `./setup-hermes.sh --runtime-only` (upstream path: stages the uv pinned in `pm/lock.json`, installs managed **CPython 3.14** — Ubuntu 24.04 ships 3.12 and `pyproject` gates core deps such as browser-harness on `python_version >= '3.14'` — then a hash-verified `uv.lock` sync; no pnpm web/TUI). Extras needed: `slack`, `edge-tts`, `stt-whisper`, `anthropic` (S2 confirms how pm selects extras; fallback `uv sync --frozen --no-dev --python 3.14 --extra slack --extra edge-tts --extra stt-whisper --extra anthropic`). Wrapper `/usr/local/bin/hermes` | `/opt/agentbox/vendor/hermes-agent/<tag>`; S2 checks where pm puts the venv (on the Mac it lives under `~/.hermes/installs/<hash>/…`, i.e. in `HERMES_HOME`, not in the ro install dir) |
| Hermes UI | v0.3.0 (new) | GitHub Release tarball `hermes-ui-<v>.tgz` (prebuilt `web/dist`) + sha256 → `npm ci --omit=dev --ignore-scripts` | `/opt/agentbox/vendor/hermes-ui/<v>` |
| Paseo CLI | `@getpaseo/cli` 0.17.x (S3, see C6) | `npm i -g --prefix /opt/agentbox/vendor/paseo/<v> @getpaseo/cli@<v>` with `npm ci`-style lockfile shipped in the manifest | wrapper `/usr/local/bin/paseo` |
| paseo-mcp | v0.5.0 (new: Paseo 0.17 pin) | **The unscoped npm name `paseo-mcp` belongs to another maintainer** (v0.1.0, not ours) [resolved 05]. Ship as GitHub Release tarball + sha256 (`paseo plugin install <dir>`), optionally also a scoped npm package (`@<scope>/paseo-mcp`). Installed as a Paseo plugin **and** as a stdio bin for Hermes | plugin dir under `PASEO_HOME`, bin in Paseo prefix |
| paseo-multi-account | v1.1.0 (new tag) | GitHub Release tarball → `paseo plugin install <dir>` (verified: `plugin install` accepts a registry slug, host directory, Git URL or `npm:` source) [resolved 05] | `PASEO_HOME/plugins/…` |
| hermes-paseo-bridge | v0.1.0 (new) | GitHub Release tarball extracted to `/home/agentbox/.hermes/plugins/hermes-paseo-bridge` + `hermes plugins enable hermes-paseo-bridge` (verified: `hermes plugins install` only takes a catalog name, Git URL or owner/repo, not a tarball/dir; the documented drop-in dir + `enable` is the local path; alternative `hermes plugins install <git-url> --ref <sha> --enable --yes-deps`) [resolved 05] | `HERMES_HOME/plugins` |
| iroh-gateway | v0.6.4 | iroh-bridge release `iroh-gateway-v0.6.4-<arch>-unknown-linux-musl.tar.gz` + `.sha256` | `/opt/agentbox/vendor/iroh-gateway/<v>` |
| iroh client (`agentbox connect`) | iroh-fetch 0.6.4 | laptop: `agentbox connect` = own local proxy on `createIrohFetch({secretKey, engine: "native"})` (the stock `iroh-proxy` CLI can't take a fixed key, C1). The native napi addon (prebuilt for linux x64/arm64, macOS, win x64) gives direct UDP paths; WASM is relay-only. S8 decides whether Bun can embed the addon | laptop |
| Caddy | 2.11.x (current 2.11.9) | caddyserver GitHub release tarball + sha256 (no apt repo) | `/opt/agentbox/vendor/caddy/<v>` |
| KasmVNC | 1.5.x (current 1.5.2) | `kasmvncserver_ubuntu_noble_<v>_{amd64,arm64}.deb` from GitHub release (verified asset name) + sha256, `apt install ./x.deb` | system |
| Chrome / Chromium | Chrome stable (x64) via Google apt repo, signed. arm64: Playwright Chromium build pinned (S6) | apt with pinned repo key. Updates go through unattended-upgrades; restart is deferred while agents are active | system |
| openbox, ffmpeg, git, jq, curl, tmux, build-essential, fonts-noto, xdg-utils (no `python3-venv`: Hermes uses a managed CPython 3.14) | Ubuntu 24.04 archive | apt | system |
| Claude Code | `@anthropic-ai/claude-code` exact version | npm into `/opt/agentbox/vendor/agent-clis`, `DISABLE_AUTOUPDATER=1` | wrapper `/usr/local/bin/claude` |
| Codex CLI (optional, catalog) | `@openai/codex` exact version | npm, same prefix | `/usr/local/bin/codex` |
| gh | 2.x exact | GitHub release `.deb` + sha256 | system |
| glab | 1.x exact | GitLab release `.deb` + sha256 | system |
| cloudflared (opt-in webhooks) | exact | GitHub release `.deb` + sha256, only on `webhooks expose cloudflared` | system |
| browser-harness | from Hermes venv | core Hermes dependency (`browser-harness==0.1.13`, only on Python ≥ 3.14) [resolved 05]; attach via `browser.cdp_url` (§11) | Hermes venv |

New releases (hermes-ui 0.3.0, paseo-mcp 0.5.0, multi-account 1.1.0, bridge 0.1.0) are produced by the per-repo WPs in §15.

---

## 5. Host layout

### 5.1 Users
| User | Purpose | Notes |
|---|---|---|
| `agentbox` (uid 10001) | Runs config server, Hermes, Hermes UI, Paseo + agents, KasmVNC, Chrome | `$HOME=/home/agentbox`, shell bash, no password, **no general sudo** |
| `agentbox-edge` (system) | Runs Caddy and iroh-gateway | no shell, no home. The only uid allowed to reach :8081 |
| root | `agentbox up`, `agentbox host apply` | `/etc/sudoers.d/agentbox`: `agentbox ALL=(root) NOPASSWD: /usr/local/bin/agentbox host apply *`. `host apply` only accepts plan ids from the embedded manifest (apt CLIs from the catalog, unit restarts, firewall), never free-form commands |

### 5.2 Directories
| Path | Owner / mode | Content |
|---|---|---|
| `/opt/agentbox/releases/<v>/`, `/opt/agentbox/current →` | root, ro | agentbox binary, unit templates, Caddyfile template, catalog snapshot; keep last 3 |
| `/opt/agentbox/vendor/<component>/<v>/` | root, ro | pinned third-party components (§4) |
| `/etc/agentbox/config.toml` | root:agentbox 0640 | non-secret config: listen mode, channel, ports, `ui_url` for pairing links, telemetry opt-in |
| `/var/lib/agentbox/state/agentbox.db` | agentbox 0600 | SQLite: users, sessions, otp, devices, onboarding, catalog cache, runs |
| `/var/lib/agentbox/secrets/` | agentbox 0700 | age store + `identity` |
| `/var/lib/agentbox/iroh/` | agentbox-edge 0700 | `gateway.key`, `gateway.env` (rendered by agentbox via `host apply iroh-config`) |
| `/var/lib/agentbox/chrome-profile/` | agentbox 0700 | persistent Chrome profile |
| `/var/lib/agentbox/caddy/` | agentbox-edge | Caddy data (internal CA, ACME) |
| `/var/lib/agentbox/first-run.txt` | root 0600 | OTP URL, LAN URL, cert fingerprint, SSH command |
| `/run/agentbox/env/*.env` | agentbox 0600, tmpfs | rendered secrets per unit |
| `/home/agentbox/.hermes/` | agentbox | `HERMES_HOME`: config.yaml, profiles/, skills/, plugins/, cron/, SOUL.md, mcp-tokens/ |
| `/home/agentbox/.paseo/` | agentbox | `PASEO_HOME`: config.json, claude-accounts.json, worktrees/ |
| `/home/agentbox/.claude-accounts/<slug>/` | agentbox 0700 | per-account `CLAUDE_CONFIG_DIR` (`.credentials.json`) |
| `/home/agentbox/.ssh/id_ed25519` | agentbox 0600 | generated in onboarding |
| `/home/agentbox/work/<host>/<owner>/<repo>` | agentbox | cloned repos |

### 5.3 systemd units (`/etc/systemd/system/`, all `PartOf=agentbox.target`)
| Unit | ExecStart | User | Key settings |
|---|---|---|---|
| `agentbox.target` | – | – | `WantedBy=multi-user.target` |
| `agentbox-firewall.service` | `agentbox host firewall apply` | root | oneshot, `Before=agentbox-iroh.service` |
| `agentbox-config.service` | `/opt/agentbox/current/agentbox serve` | agentbox | `ExecStartPre=agentbox secrets render config`, `NoNewPrivileges=no` (needs the sudo helper), `ProtectSystem=strict`, `ReadWritePaths=/var/lib/agentbox /home/agentbox /run/agentbox` |
| `agentbox-caddy.service` | `caddy run --config /opt/agentbox/current/Caddyfile --adapter caddyfile` | agentbox-edge | `AmbientCapabilities=CAP_NET_BIND_SERVICE` (only for opt-in :443), `ProtectSystem=strict`, env from rendered `caddy.env` (proxy secret) |
| `agentbox-iroh.service` | `iroh-gateway` with `IROH_CONFIG_FILE=/var/lib/agentbox/iroh/gateway.env`, `IROH_KEY_FILE=…/gateway.key`, `IROH_ADMIN_ADDR=127.0.0.1:8090` | agentbox-edge | `ExecReload=/bin/kill -HUP $MAINPID`, `Restart=always` |
| `agentbox-hermes.service` | `hermes gateway run --replace --external-supervisor` | agentbox | `Environment=HERMES_HOME=/home/agentbox/.hermes`, `EnvironmentFile=/run/agentbox/env/hermes.env`, `Restart=always`, `KillMode=mixed`, `TimeoutStopSec=60` |
| `agentbox-hermes-ui.service` | `node bin/hermes-ui.mjs serve` | agentbox | `HERMES_UI_PORT=8787`, `HERMES_UI_REMOTE=off`, `HERMES_UI_AUTH=proxy`, `HERMES_UI_BASE_PATH=/hermes`, `HERMES_UI_DATA_DIR=/var/lib/agentbox/hermes-ui`, `PASEO_MCP_URL`/token from env file |
| `agentbox-paseo.service` | `paseo daemon run --home /home/agentbox/.paseo` | agentbox | `PASEO_HOME=/home/agentbox/.paseo`, listen `127.0.0.1:6767` (`daemon.listen` / `PASEO_LISTEN`), relay off (`daemon.relay.enabled=false` / `PASEO_RELAY_ENABLED=false`), web UI off (`features.webUi.enabled=false`, also the default), `Restart=always`, `KillMode=process` (agent turns survive daemon restart where Paseo supports it) |
| `agentbox-kasmvnc.service` | `kasmvncserver :1 -fg -websocketPort 6901 -interface 127.0.0.1 -select-de openbox -DisableBasicAuth` [verify S6] | agentbox | `Restart=always`. Verified in the 1.5.2 wrapper: `-fg`, `-websocketPort`, `-interface`, `-select-de` are wrapper options; `DisableBasicAuth` is an Xvnc parameter that the wrapper passes through. Needs `~/.vnc/kasmvnc.yaml` with `network.ssl.require_ssl: false` (default `true` with the snakeoil cert, which also needs `ssl-cert` group membership) and `network.udp.public_ip: 127.0.0.1`. The Perl wrapper is **interactive on first run** (create kasmpasswd user, pick DE, grant write); `agentbox up` pre-seeds `~/.kasmpasswd` and `~/.vnc/` or S6 switches to running `Xvnc` + `openbox` directly |
| `agentbox-chrome.service` | `google-chrome --user-data-dir=/var/lib/agentbox/chrome-profile --remote-debugging-address=127.0.0.1 --remote-debugging-port=9333 --no-first-run --no-default-browser-check --disable-dev-shm-usage --start-maximized` | agentbox | `Environment=DISPLAY=:1`, `BindsTo=agentbox-kasmvnc.service`, `After=…`, `KillSignal=SIGTERM`, `TimeoutStopSec=30`, `Restart=always` |
| `agentbox-update.timer` / `.service` | `agentbox update --check` | root | daily, download only. Apply is manual in v1 |
| `agentbox-backup.timer` (optional) | `agentbox backup` | agentbox | nightly encrypted tar of `.hermes`, `.paseo/*.json`, chrome-profile (Chrome quiesced via CDP `Browser.close` is v2; v1 copies with `--sparse` while running and documents the risk) |

Health endpoints used by `agentbox doctor`, `agentbox up` verify and e2e: `:7777/healthz`, `:8090/healthz` (gateway admin; verified, returns **503 "endpoint offline" while no relay is reachable**, so doctor warns instead of failing on offline LAN boxes; `/readyz`, `/status`, `/metrics` also exist), `:8787/api/health` (verified in hermes-ui, reports `gateway` connected), `:6767/api/health` (verified in Paseo server), `:9333/json/version`, `:6901` HTTP 200, `:8644/health` when the webhook platform is on (verified), `systemctl is-active agentbox-hermes`, Caddy `:8080/healthz` (static respond). **Not** `hermes gateway status`: it always exits 0, even when it prints "✗ Gateway is not running" [resolved 05].

---

## 6. Access and auth flow

### 6.1 Install and first access
1. `curl -fsSL https://get.agentbox.dev | sh` checks Ubuntu 24.04 and `uname -m` ∈ {x86_64, aarch64}, downloads and verifies the binary, and prints `next: sudo agentbox up`. With `AGENTBOX_UP=1` it runs `agentbox up` directly. This is the one-liner documented for launch: `curl -fsSL https://get.agentbox.dev | sudo AGENTBOX_UP=1 sh`.
2. `sudo agentbox up` = host converge (providers in §15 WP-AB-2). It is idempotent, and re-running it is the repair. At the end it:
   - generates the OTP and stores only its argon2id hash plus expiry,
   - writes `/var/lib/agentbox/first-run.txt`,
   - prints:
```
✔ Agentbox is running (9/9 services healthy)
  Open:  https://192.168.1.50:8443/setup#otp=river-lamp-oak-mint-fold-acre
         (self-signed certificate, SHA-256 fingerprint 3F:A1:…:9C)
  or:    ssh -L 8080:127.0.0.1:8080 you@192.168.1.50  →  http://localhost:8080/setup#otp=…
  One-time code: river lamp oak mint fold acre   (valid 60 min · new code: sudo agentbox otp)
  [ASCII QR of the LAN URL]
```
   The OTP is in the URL **fragment**, so it never reaches logs or proxies. The page posts it.
3. **Claim (screen 1):** OTP (prefilled) + name + email (recovery hint only) + password (zxcvbn ≥ 3). The passkey option shows only on a secure origin. Success creates the `owner` user, burns the OTP, sets the session cookie (12 h sliding, 30 d with "remember this device") and returns 404 for `/setup` from now on.
4. Recovery: `sudo agentbox reset-owner` (needs root on the VM) issues a new OTP that only allows setting a new password.

### 6.2 iroh pairing (steady state, one registry)
- **Gateway lifecycle:** `agentbox-iroh` starts with `IROH_ALLOW_PATHS=/__closed__` while there are no devices and no open pairing window. The endpoint id is read from the gateway's stdout line `IROH_ENDPOINT_ID=<id>` (verified in `crates/gateway/src/main.rs`; admin `/status` returns relays and routes, the id there is unconfirmed) and stored in config. It is stable because `IROH_KEY_FILE` persists the secret key.
- **Pair a device** (config UI "Devices" or Hermes UI "Pair your phone", both call `POST /api/devices/pair/start`):
  - the server creates a single-use 8-char code (TTL 10 min, hash stored),
  - it renders `gateway.env` with `IROH_ALLOW_CLIENTS=` (empty = everyone) and `IROH_ALLOW_PATHS=/`, then SIGHUPs via `sudo agentbox host apply iroh-config`,
  - it returns `{endpointId, code, links}`:
    - **Phone/PWA link:** `<ui_url>/#iroh=<endpointId>&code=<code>&base=/hermes`. `ui_url` defaults to the generic static Hermes UI build on GitHub Pages (data-free) and is configurable in `config.toml`.
    - **Laptop command:** `agentbox connect <endpointId> --code <code>`.
- **Device side:** the client uses a **persistent** iroh identity (PWA: iroh-fetch `persistIdentity: true`; laptop: key file `~/.config/agentbox/connect.key` passed as `secretKey`). It calls `POST /api/devices/pair/complete {code, name}` through the gateway. While the window is open, Caddy :8081 → forward_auth lets unknown ids reach only `/api/devices/pair/*`.
- **Complete:** the server stores `devices(id, user_id, name, kind, iroh_id, created_at, last_seen_at, revoked_at)` and re-renders `IROH_ALLOW_CLIENTS=<all active iroh_ids>`, `IROH_ALLOW_PATHS=` (all). It closes the window (SIGHUP), and the code is burned. After that the gateway refuses unknown ids at connection time.
- **Requests:** gateway → Caddy :8081 with `X-Iroh-Remote-Id`. forward_auth maps it to the device → owner and sets `X-Agentbox-User`. Hermes UI and the config UI treat it like a session.
- **Revoke:** `DELETE /api/devices/:id` → re-render + SIGHUP. The gateway disconnects the client on its next request (verified: the allow list is re-checked per stream, "client no longer in allow list, closing connection").
- **CLI:** `agentbox devices list|pair|revoke`, and `agentbox connect` on the laptop (same binary; subcommand works on macOS/Linux/Windows builds; §15 WP-AB-6).
- **Relay:** n0 public relays by default. `IROH_RELAY_URL`/`IROH_RELAY_TOKEN` in `config.toml` (needed for SaaS, v2).

### 6.3 Auth matrix
| Surface | How it authenticates |
|---|---|
| Config UI/API on :8080/:8443 | session cookie |
| Same via iroh (:8081) | paired device id |
| Hermes UI | Caddy forward_auth (either of the above) → `X-Agentbox-User` + proxy secret |
| KasmVNC `/browser/` | Caddy forward_auth. KasmVNC's own basic auth is disabled. Loopback bind only |
| `agentbox` CLI as root/agentbox | local `cli.token` in `/run/agentbox` (existing mechanism) |
| Hermes → MCPs | per-server tokens in Hermes config/`mcp-tokens` |
| Paseo daemon | loopback only. paseo-mcp HTTP uses read/write tokens rendered into the hermes and hermes-ui env |
| Webhooks | per-route HMAC (Hermes `generic` / Standard Webhooks) |

---

## 7. Secrets

- **Store:** age store (`packages/infra/src/secrets`). Keys are namespaced: `ai/anthropic_api_key`, `claude/<slug>` (marker only; creds live in the account dir), `slack/bot_token`, `slack/app_token`, `paseo-mcp/read_token`, `paseo-mcp/write_token`, `caddy/proxy_secret`, `webhook/<route>`, `catalog/<item>/<ENV>`.
- **Render:** `agentbox secrets render <unit>` writes only the keys mapped to that unit (mapping in manifest) to `/run/agentbox/env/<unit>.env`.
- **Exceptions:** CLI-native credential files stay where the CLIs expect them (`~/.config/gh/hosts.yml`, `~/.config/glab-cli`, `.claude-accounts/*/.credentials.json`, `~/.codex/auth.json`, Hermes `mcp-tokens/`). `agentbox doctor` checks modes are 0600.
- **UI rule:** secrets are write-only. The API returns `{set: true, last4}` at most. Run-event redaction (existing) covers PTY transcripts, which are never persisted beyond 24 h.
- **Chrome profile** is treated as a secret: 0700, included in the encrypted backup, never proxied via CDP.

---

## 8. Onboarding (config UI)

All screens share:
- a progress rail,
- **"Skip → open Hermes UI"** on every step (the only hard requirement is one working model provider for Hermes),
- every step is re-runnable later from Settings,
- state is persisted in the `onboarding` table, so a reload resumes where you left off,
- long jobs (installs, clones) run as agentbox runs with live SSE logs in a bottom drawer.

| # | Screen | UI | Backend actions | Done when |
|---|---|---|---|---|
| 1 | **Claim** | OTP, name, email, password, optional passkey | create owner, burn OTP | session issued |
| 2 | **Connect AI** | Two cards. **(a) Claude subscription accounts** ("Add account" repeatable, ≥1 recommended, 2+ for multi-account). **(b) API keys** (Anthropic, OpenAI, OpenRouter; masked input, "Get key ↗"). Then a default model picker for Hermes | (a) PTY `claude auth login --claudeai` with `CLAUDE_CONFIG_DIR=…/<slug>` → parse URL → show URL + paste box → write the code to the PTY → `claude auth status` → register the account as a Paseo provider: `agents.providers.<slug> = {extends: "claude", label, enabled: false, env: {CLAUDE_CONFIG_DIR}}` in `PASEO_HOME/config.json` + `paseo daemon reload` (verified: multi-account derives its accounts from exactly these entries; `claude-accounts.json` only holds `activeAccountId`, pins and identities) [resolved 05]. (b) validate live with a cheap models call. Configure Hermes: `hermes auth add <anthropic|openai|openrouter> --type api-key` (key via the secure prompt/stdin, never `--api-key` in argv) or `hermes auth add anthropic --type oauth --no-browser` for a Claude subscription, then model via `hermes config set model …` (verified verbs; non-interactive behaviour in S2) | Hermes answers a probe prompt, and ≥1 Paseo account is `ready` (or an API key fallback) |
| 3 | **Who are you?** | Role cards (multi-select): Developer, Manager/PM, Founder/Ops, Data, DevOps/SRE, Support, Designer/Marketer, Custom. Optional one-line "Describe your work" + timezone + language | stores `roles[]`, `about`. The user's model refines the bundle selection (one structured call: input bundle YAML + about → JSON of add/remove ids, constrained to catalog ids) | roles saved |
| 4 | **Your toolkit** | Three columns: Skills, MCP servers, CLIs, preselected from the bundles; plus a **library autocomplete** (§9). Each row: icon, name, tier badge, source, licence, 🔑 if auth needed, "why suggested". Env/permission diff shown before adding non-curated items | none yet (selection only) | selection saved |
| 5 | **Your SOUL** | Preview of the composed `SOUL.md` for the default (orchestrator) profile, with editable sections: About you, How I work on this box (generated, read-only facts), Tone, Guardrails. "Regenerate with AI" button | compose from templates (§10) + user facts | saved to `HERMES_HOME/SOUL.md` |
| 6 | **Connect accounts** | Only what the selection needs. **Device-flow cards** (gh: `gh auth login --web --git-protocol ssh --skip-ssh-key -s admin:public_key -h github.com` — `admin:public_key` is needed for `gh ssh-key add` on screen 7; glab: **`glab auth login --device --hostname gitlab.com --git-protocol ssh`** — `--web` is a localhost-callback OAuth flow, `--device` is the headless device flow and needs GitLab ≥ 17.9 [resolved 05]; PAT fallback for older self-hosted GitLab): big code, Copy, Open link, spinner, "✓ signed in as @x". **OAuth MCP cards** (Gmail, Slack hosted MCPs): open the authorize URL **inside the streamed Chrome** (the callback hits the box's localhost) with a "Paste redirect URL" fallback. **API-key cards** with masked input + live check. **Slack platform card**: link to the prefilled app manifest + paste bot/app tokens (Socket Mode) + pick home channel. **Git identity**: name/email prefilled from gh | PTY runner `apps/agentbox/src/pty/` with per-CLI parsers. Tokens stay in CLI stores, and dependent MCPs reuse them (GitHub MCP reads `gh auth token` at render time). Hermes MCP config is written via `hermes mcp add <name> --url … | --command … --args …` (`--env K=V`, `--auth oauth|header`; verified) or YAML merge for servers that need static header values (`mcp add` has no header-value flag) | each required card green or explicitly skipped |
| 7 | **SSH & repos** | "Generate ed25519 key" (default on) → public key + [Add to GitHub] / [Add to GitLab] (via gh/glab API) or Copy. Import-existing option. Repo picker: searchable list from gh/glab sorted by last push, multi-select. Option "Let an agent set up each repo" | `ssh-keygen -t ed25519 -N ''`, `gh ssh-key add`, `glab ssh-key add`. Background clone runs into `work/`. Optional Paseo task per repo using skill `agentbox-repo-setup` | keys registered; clones started (not required to finish) |
| 8 | **Your agents** | The AI drafts 1–3 profiles from roles + repos + selection (e.g. "Reviewer", "Inbox assistant", "Ops"). Each card: name, purpose, skills/MCP subset, cron suggestions (off by default, e.g. a morning brief to the Slack home channel), editable SOUL preview. [Accept all] / edit / remove | one structured LLM call → validated JSON (profile name slug, role template id, skills ⊆ installed, mcps ⊆ installed, crons). `hermes profile create <slug> --no-alias` (verified; slug must match `^[a-z0-9][a-z0-9_-]{0,63}$` and not be reserved; `--no-alias` avoids wrapper scripts in `~/.local/bin`) + write `profiles/<slug>/SOUL.md` and `config.yaml` toolsets | profiles exist and `hermes -p <slug> chat -q ping` answers |
| 9 | **Browser logins** | Embedded KasmVNC (`/browser/`) showing the box's Chrome, plus a checklist of suggested sites from the selection (GitHub, Google, Slack, Linear…). "Take control" toggle (sets `/var/lib/agentbox/browser.lock`; the browser skill says agents must pause while it exists) | none beyond the UI | user clicks Done (optional) |
| 10 | **Install & hand-off** | Summary of what will be installed → [Apply]. A live run log. Then **"Open Hermes UI"** with the first-task composer prefilled from the bundle's `first_task` + 3 chips, and a "Pair your phone" side panel (QR from §6.2) | apply run: install skills/MCPs/CLIs, write Hermes config, enable bridge, restart hermes (graceful). Verify: Hermes health, `mcp list` shows each server connected, bridge loaded. Redirect to `/hermes/?compose=<urlencoded>` | Hermes UI opens with composer prefilled; record TTFT |

Note on ordering: install of CLIs needed for screen 6 (gh, glab) happens **immediately when selected on screen 4** (background run), so device flows on screen 6 never wait for apt.

The conversational alternative is the skill `agentbox-onboard` (§9.4). It calls the same oRPC procedures through `agentbox api` from inside Hermes, so a user can re-run onboarding by chatting.

---

## 9. Catalog v1

### 9.1 Sources
| Source | How | When |
|---|---|---|
| **Curated** `agentbox/catalog/items/*.yaml` + `catalog/bundles/*.yaml` | in-repo, PR-reviewed, embedded in the binary | always, offline, tier T0 |
| **Official MCP Registry** `https://registry.modelcontextprotocol.io/v0.1/servers?search=…` (`v0` and `v0.1` both answer 200; `v0.1` is the frozen API) | live search proxied by the config server, results cached in SQLite (`catalog_cache`, TTL 24 h) and normalized from `server.json` | online only, tier T1 if the namespace is verified, else T2/T3 |
| **anthropics/skills** | index built at release time (exclude the source-available `docx`/`pdf`/`pptx`/`xlsx` skills from auto-install, their licence is not open source) (`scripts/catalog-build.ts`: GitHub tree at a pinned SHA → name/description/licence per `SKILL.md`), embedded as JSON; install = sparse fetch of the folder at that SHA | offline search, online install, T1 |
| **Hermes built-in** `optional-skills/`, `optional-mcps/`, bundled `skills/` | indexed from the installed Hermes tag at `agentbox up` | offline, T1 |

Out for v1: PulseMCP, Smithery, Glama, mcp.so, skills.sh scraping, the cloud ingest pipeline and signed snapshots.

### 9.2 Item schema (`packages/contract/src/catalog.ts`, zod; same shape as 03 `CatalogItem`)
```yaml
id: mcp.github                 # kind-prefixed, stable
kind: mcp                      # skill | mcp | cli | bundle
name: GitHub
summary: Issues, PRs, code search
source: [curated]              # curated | mcp-registry | anthropics-skills | hermes
tier: T0
licence: MIT
roles: [developer, devops]
install:
  mcp: { transport: http, url: https://api.githubcopilot.com/mcp/, headers: { Authorization: "Bearer ${gh.token}" } }
auth: { type: derived, from: cli.gh }   # none | api_key | oauth | device | derived
env: []                        # [{name, secret: true, help_url}]
targets: [hermes, paseo]       # where it is registered
pinned_version: null
```
`install` variants: `mcp` (stdio `npx -y pkg@ver` / `uvx pkg==ver` / http url), `skill` (git url + sha + path → copied to `HERMES_HOME/skills/<category>/<name>/` and, if `targets` contains `claude`, to `/home/agentbox/.claude/skills/`), `cli` (manifest plan id for `host apply`, e.g. `cli.gh`).

### 9.3 Bundles (YAML, v1 ships 7)
`developer`, `manager`, `founder-ops`, `data`, `devops`, `support`, `designer-marketer`, each with `skills[]`, `mcps[]`, `clis[]`, `soul_role` (template id), `first_task`, `first_task_alternatives[3]`, `suggested_sites[]`, `suggested_crons[]`.
- **`base`** (always included): skills `grounded-citations`, `document-to-action-items`, `meeting-action-items`, `email-inbox-triage`, `weekly-review-planning`, `humanizer`, `pdf`, `blocked-page-recovery`, `agentbox-*` skills (§9.4; `agentbox-browser` is the Linux CDP-9333 attach skill — browser-harness itself is a Python package in the Hermes venv, not a skill). All non-agentbox names above are bundled upstream skills in `v0.23.3` (verified). MCP `paseo`. CLI `git`.
- **developer:** + `github`, `systematic-debugging`, `test-driven-development`, `requesting-code-review`, `simplify-code`, `spike`, `codebase-inspection`, `claude-code`, Claude skills `frontend-design`. MCPs GitHub, Context7, Playwright (opt-in), Postgres read-only (opt-in), Sentry (opt-in). CLIs gh, glab.
- **manager / founder-ops:** + `competitor-news-monitor`, `product-price-monitor`, `architecture-diagram`. MCPs Gmail, Slack, Google Calendar, Linear/Notion (opt-in). Cron template "morning brief" (disabled). (`user-story-manager` was dropped: it is a personal skill, not in upstream Hermes; if wanted, ship a clean generic rewrite under `agentbox/catalog/skills/`.)
- Other bundles are as listed in 03 §3, limited to items that have a public, free MCP/skill.

The `bundles` CI job (WP-CAT-3) validates every YAML against the schema and checks that every referenced id exists. A nightly job installs `developer` + `manager` on a fresh VM image (§16 script with `--bundle`).

### 9.4 Agentbox skills (agentskills format, shipped in `agentbox/catalog/skills/`, installed by `base`)
`agentbox-onboard`, `agentbox-add-tool`, `agentbox-auth-cli`, `agentbox-ssh`, `agentbox-repo-setup`, `agentbox-make-agent`, `agentbox-doctor`, `agentbox-browser` (attach to 9333, respect `browser.lock`, never launch Chrome, open own tabs, never close human tabs). Each calls the local `agentbox api <procedure> --json` (CLI token auth) instead of editing config directly. `agentbox-catalog-curate` is internal and not shipped.

### 9.5 Ranking and dedupe
Score = text match (SQLite FTS5 bm25) × tier weight (T0 4, T1 3, T2 2, T3 hidden unless toggled) × role affinity (1.5 if the item lists a selected role) × log(popularity+2) (registry has none → 1). Dedupe by normalized repo URL and package name, preferring curated.

---

## 10. SOUL templates and profiles

Files in `agentbox/catalog/soul/`: `soul-base.md`, `box-facts.md` (generated), `role-{orchestrator,developer,manager,ops,support,data,designer}.md`. A profile's SOUL = base + box-facts + role + user section. Mustache-style placeholders are filled from onboarding state. On regeneration only the `<!-- agentbox:generated -->` blocks are rewritten, and user edits outside them survive.

**`soul-base.md`**
```md
# Who you are
You are {{agent.name}}, {{user.name}}'s assistant on their personal Agentbox ({{box.hostname}}).
You work for {{user.name}} only. Language: {{user.language}}. Timezone: {{user.timezone}}.

# How you work
- Be direct. Lead with the outcome. Short answers for short questions.
- Do the work with tools; never invent output. If blocked, say so and propose the next step.
- Ask before anything irreversible or outward-facing (sending mail, posting, merging, deleting, paying).
- Secrets: never print, log or paste credentials. Use the vault and the configured CLIs.

# About {{user.name}}
{{user.about}}
Roles: {{user.roles}}
```

**`box-facts.md`** (generated, read-only in the UI)
```md
<!-- agentbox:generated -->
# This box
- Coding work goes to Paseo agents via the `paseo` MCP (paseo_create_agent with cwd in ~/work/...).
  Their events come back into this session automatically (hermes-paseo-bridge); don't poll in a loop.
- Claude accounts: {{paseo.accounts}} (switch/pin via the Paseo multi-account plugin; default {{paseo.default}}).
- Repos: {{repos.list}} under /home/agentbox/work/<host>/<owner>/<repo>.
- Browser: one shared, logged-in Chrome. Attach via CDP http://127.0.0.1:9333 (browser-harness).
  Never launch another Chrome. If /var/lib/agentbox/browser.lock exists, the human is using it: wait.
  Logged-in sites: {{browser.sites}}.
- CLIs authenticated: {{clis.authed}}. Git identity: {{git.name}} <{{git.email}}>.
- MCP servers: {{mcps.list}}. Skills: see `skills_list`.
- Delivery: home channel {{delivery.home}}; crons may deliver to {{delivery.targets}}.
- Box changes (install tools, add MCPs, new agents, auth) go through the agentbox-* skills, not by editing config files.
<!-- /agentbox:generated -->
```

**Role snippets** (examples; each 10–20 lines in the repo)
- `role-orchestrator.md` (default profile): plan → delegate coding to Paseo agents (one per repo/task, a clear brief, acceptance criteria) → review results → report. Never code large changes yourself in this session.
- `role-developer.md`: TDD, small PRs, run tests before claiming done, use `gh`/`glab` for PRs, follow repo AGENTS.md.
- `role-manager.md`: summaries with owners and dates, cite sources, draft never send.
- `role-ops.md`: triage alerts by impact, check recent deploys first, propose rollback before fix, no prod writes without approval.
- `role-support.md`, `role-data.md` (read-only SQL by default, show the query), `role-designer.md`.

**Profiles:** default = orchestrator (base + box-facts + orchestrator + user's roles merged). Generated profiles (screen 8) get base + box-facts + their role + purpose. They inherit the model and get a scoped skill/MCP list in `profiles/<slug>/config.yaml`. The data model keeps `profiles.shared_scope` (`private` only in v1) as the org-sharing hook.

---

## 11. Browser stream

- **Stack:** KasmVNC (`Xvnc :1` + built-in web client, WS on 127.0.0.1:6901, no own TLS/auth) + openbox + one Chrome (x64: Google Chrome; arm64: Chromium, S6) with a persistent profile and CDP on 127.0.0.1:9333.
- **Access paths:**
  1. **Config UI** (LAN :8443, SSH tunnel, or `agentbox connect`): `/browser/` through Caddy with forward_auth and WS upgrade. This covers onboarding screen 9 on Proxmox.
  2. **Laptop remote:** `agentbox connect` → `http://localhost:8080/browser/` over iroh (the iroh-fetch client passes WebSockets through).
  3. **Phone remote:** a Hermes UI "Browser" tab that loads the vendored KasmVNC JS client from the PWA bundle and opens its WebSocket through iroh-fetch `install()` to `/browser/websockify` (S7). If S7 fails, the phone shows "Open on laptop/LAN" and the CDP-screencast lite view moves to v1.1.
- **Agents:** browser-harness and Hermes browser tools attach via `hermes config set browser.cdp_url http://127.0.0.1:9333` (verified config key; `BROWSER_CDP_URL` env overrides it; `/browser connect` is only an in-session slash command) [resolved 05]. Paseo `browserTools` is **not** a CDP setting: the daemon brokers browser tools to a connected Paseo client app (`BrowserToolsBroker`), so on the headless box set `daemon.browserTools.enabled=false`; Paseo agents use the box Chrome through the `agentbox-browser` skill / browser-harness instead. The `agentbox-browser` skill encodes the attach-only and lock rules.
- **Take control:** the config UI toggle creates/removes `browser.lock` and shows a banner in Hermes UI. This is best effort and documented as such.
- **Resolution:** KasmVNC dynamic resize on. Mobile clients get a portrait viewport and JPEG quality tuned via KasmVNC settings (S7).
- **Universal OAuth fallback:** any CLI or MCP with a `localhost` callback is completed by opening its URL in this Chrome (agentbox does it via CDP `Target.createTarget`), so the callback lands on the box.
- **Security:** 9333 is never proxied. `/browser/` requires box auth. The profile dir is 0700. The CDP-exposure check in `agentbox doctor` fails if 9333 listens on anything but loopback.

---

## 12. Stack wiring and benchmark mapping

### 12.1 Hermes (must 1, 6, 10, 12, 13)
- Config written by agentbox (WP-AB-7) via `hermes config set` where available, YAML merge otherwise. It covers model/provider, `mcp_servers`, platforms (slack, webhook — **set `platforms.webhook.extra.host: 127.0.0.1`**, upstream's default binds all interfaces on :8644), tts `edge` (default; needs the `edge-tts` extra), stt local whisper (needs the `stt-whisper` extra + ffmpeg), `browser.cdp_url`, plugins enable (bridge). Disable unattended plugin updates (`hermes plugins auto-update` off) so pins hold.
- Hermes' own vault stays as is (must 13). Agentbox secrets are separate and render into env.
- Cron is native Hermes (`cron/jobs.json`). Onboarding only creates suggested jobs disabled. Script-only jobs (`local`) work as upstream (must 6/8).

### 12.2 Paseo + multi-account (must 2)
- `paseo daemon config set daemon.listen 127.0.0.1:6767`, `features.webUi.enabled false`, `daemon.relay.enabled false`, `daemon.mcp.injectIntoAgents true`, `daemon.browserTools.enabled false` (keys verified against the `@getpaseo/server` 0.17.3 config schema; env equivalents `PASEO_LISTEN`, `PASEO_RELAY_ENABLED`, `PASEO_WEB_UI_ENABLED`) [resolved 05].
- Plugins: paseo-mcp (creates read/write tokens → secrets), multi-account (accounts from screen 2, default account, per-agent pinning available in Hermes UI/paseo-mcp `defaultAccount`).
- Hermes MCP `paseo`: stdio `paseo-mcp` with `PASEO_MCP_CONFIG=/home/agentbox/.config/paseo-mcp/config.json` (as on the Mac; there is no `PASEO_DAEMON_URL` env). The file sets `daemonUrl: ws://127.0.0.1:6767/ws`, `allowedRoots: ["~/work"]`, `originLabel: hermes`, `accounts`/`defaultAccount` mirroring the Paseo providers, `events.enabled: true`. Hermes UI uses `PASEO_MCP_URL` (plugin HTTP) for events and permissions.

### 12.3 hermes-paseo-bridge (must 3)
- **Origin tagging:** the plugin registers a `pre_tool_call` hook that returns `{"action": "modify", "args": {...labels, origin_ref}}` for the `paseo_create_agent` / `paseo_send_message` MCP tools (Hermes exposes them with an `mcp_` prefix, so match on the suffix). Verified: `pre_tool_call` supports `modify` (shallow-merged args) and receives `session_id`; the route key for delivery comes from `gateway.session_context.bound_session_key()` (a contextvar, S5 confirms it is set in the tool thread) [resolved 05]. The `_meta` fallback does **not** work today: Hermes' MCP client sends no `_meta` on `tools/call`.
- **Event intake:** a background task started with `ctx.spawn_task(coro)` (verified; supervised, cancelled on unload; needs the gateway's running loop) keeps a cursor-based `paseo_wait_for_events` long-poll over paseo-mcp HTTP (read token). Alternative: `ctx.call_mcp("paseo", "paseo_wait_for_events", …)` through Hermes' own MCP client, which needs `plugins.entries.hermes-paseo-bridge.mcp_allowlist: [paseo]`. Cursor is persisted in plugin storage. A webhook (standard-webhooks → Hermes webhook route) is the fallback if long-poll isn't usable from a plugin.
- **Delivery:** for `turn.ended` (finished/error/limit), `permission.requested`, `agent.closed` with an `origin_ref`, inject a compact message (agent title, status, last-message preview, `paseo_get_agent` hint) into that session, which resumes it, via the documented `ctx.inject_message(content, role="user", session_key=<key>)` (verified public plugin API; returns `False` if no host accepted it) [resolved 05]. Fallback: the gateway WebSocket JSON-RPC (`session.resume` + `prompt.submit`, verified in hermes-ui `src/hermes-ws.mjs`). Events without `origin_ref` go to the default profile's home channel as a summary.
- Debounce: bundle events per session within 5 s. Never resume for `turn.started`.
- Replaces `paseo_watch.mjs`, `wh_paseo_event.py`, `paseo-autoapprove` and the ngrok webhook from the Mac.

### 12.4 Hermes UI (must 4)
Served at `/hermes/` (local/LAN/connect) and as the PWA over iroh for the phone. It reads Hermes over `gateway.sock` and Paseo via paseo-mcp. Pairing is delegated to agentbox (§6.2).

### 12.5 Slack (must 5)
Screen 6 card: a prefilled Slack app manifest generated by `hermes slack manifest` (verified subcommand; includes every gateway slash command, Socket Mode) → user creates the app → pastes the bot token (`xoxb`) + app token (`xapp`) → picks the home channel. Telegram is an optional card (bot token).

### 12.6 OAuth MCPs (must 8)
Gmail/Slack hosted MCPs use OAuth in the streamed Chrome (§11), with tokens in Hermes `mcp-tokens/`. Google needs a consent screen. If Google refuses the hosted-MCP flow from a datacenter IP, use the "Paste redirect URL" fallback (S10).

### 12.7 Webhooks (must 11)
`agentbox webhooks expose cloudflared|domain <fqdn>|off`. `cloudflared` runs a quick tunnel → Caddy's dedicated webhook listener `http://127.0.0.1:8083`, which serves only `/webhooks/*` (everything else 404). The URL is shown in the config UI and updated in the route list. `domain` adds a Caddy :443 site with ACME for `/webhooks/*` only. Subscriptions are created with `hermes webhook subscribe <name> --prompt … --events … --secret … --signature generic|github|gitlab|linear [--deliver … --route-profile …]` (verified) from the config UI. Profile-bound routes live at `/p/<profile>/webhooks/<name>`, so the Caddy webhook site also allows `/p/*/webhooks/*`. Accepted deliveries return 202 (verified). Quick-tunnel URLs change on restart, which is documented, and the named-tunnel token is supported.

### 12.8 CLIs and git (must 9)
gh and glab via manifest plan ids. Device flows run in a PTY. `git config --global user.name/email` from the gh profile or form.

### 12.9 Default skills (must 14)
`base` + selected role bundles (§9.3).

| Must (01 §4) | Covered by |
|---|---|
| 1 Hermes + gateway systemd + Claude auth | §5.3, §8 s2, WP-AB-2/7 |
| 2 Paseo headless + mcp + multi-account (≥2 accounts) | §12.2, WP-PMA-1, WP-PM-1, S3/S4 |
| 3 bridge | §12.3, WP-BR-1 |
| 4 Hermes UI remote, authenticated | §6, §12.4, WP-HUI-1/2, WP-AB-4 |
| 5 Slack Socket Mode + cron delivery | §12.5, WP-AB-7 |
| 6 Hermes cron incl. script-only | upstream, §12.1 |
| 7 Persistent Chrome + CDP + login via UI | §11, WP-AB-5 |
| 8 Gmail/Slack OAuth MCPs via UI | §12.6, WP-AB-7 |
| 9 gh/glab + git identity | §12.8, WP-AB-8 |
| 10 Profiles with SOUL | §10, WP-AB-9 |
| 11 Webhook ingress | §12.7, WP-AB-10 |
| 12 TTS/STT | §12.1 (ffmpeg in apt list) |
| 13 Encrypted vault, no secret echo | §7 |
| 14 Default skill bundle | §9.3, WP-CAT-1 |

---

## 13. Per-repo cleanup work items

**agentbox**
- Delete `apps/agentbox/src/automation/`, `packages/automation/`, `apps/agentbox/src/tools/*`, `packages/contract/src/tools.ts`, app-cards/app-icons for CloudCLI/MetaMCP/Plane, `runs/demo.ts`, `packages/providers/src/workspace/{cloudcli,metamcp,plane}`, `packages/infra/src/docker` (C14), web pages `(console)/{tools,automation,image}`.
- Replace the Tailscale listener in `server/auth.ts` and `config.ts` (`Listener = "tailscale" | "local"` → `"local" | "lan" | "iroh"`; identity headers trusted only on the iroh listener via Caddy :8081 → `X-Agentbox-Via: iroh` + proxy secret).
- ADRs: mark 0004–0007 superseded. New: 0008 "Paseo + Hermes + Hermes UI + iroh stack" (the brief's ADR), 0009 "One iroh gateway and device registry (iroh-bridge)", 0010 "First access: OTP + LAN/SSH", 0011 "Native workloads, no containers in v1", 0012 "Catalog v1 sources".
- Rewrite `docs/implementation-plan.md` in English as a short pointer to this plan + ADRs. Translate README/AGENTS.md to English. Landing/Pages: one section per upstream repo (Hermes, Hermes UI, Paseo, paseo-mcp, paseo-multi-account, hermes-paseo-bridge, iroh-bridge, KasmVNC, Caddy) with how they fit.
- Release pipeline: `release.yml` (compile x64/arm64, minisign, GitHub Release, `install.sh` published to Pages at `get.agentbox.dev`).

**hermes-ui**
- PRs #9 (mobile-app store readiness) and #10 (universal-app/Tauri spike) are the only open PRs and are mobile/desktop-app work: **do not merge them for v1**; v1 builds from `main` (all other branches #11–#17 are merged). Delete local `archive/pre-publish`. Move `HANDOFF.md` out of the repo (personal note).
- Remove remote modes `tailscale-funnel`, `tailscale-serve`, `cloudflare` and `TS_*` config (`src/remote.mjs`, `src/config.mjs`, README). Keep `off | iroh` for standalone users.
- Add `HERMES_UI_AUTH=proxy` (trust `X-Agentbox-User` + `X-Agentbox-Proxy-Secret`), `HERMES_UI_BASE_PATH`, `HERMES_UI_PAIRING_URL` (delegate pair calls to agentbox), PWA `base` support in pairing links.
- systemd unit generator `scripts/systemd-unit.mjs` next to `launchd-plist.mjs`.
- Release: GitHub Actions builds `hermes-ui-<v>.tgz` with `web/dist` + sha256 on tag `v0.3.0`. Default `HERMES_UI_URL` → documented, configurable, no personal Pages URL baked into server defaults (keep a generic project Pages URL).
- Scrub personal paths in `src/local-files.mjs`, tests, `web/e2e/fixtures.ts`, README.
- Bump `iroh-fetch`/gateway default to 0.6.4.

**paseo-mcp**
- Pin `@getpaseo/*` 0.17.x (C6). The npm name `paseo-mcp` is taken by another maintainer: publish as a scoped package or ship GitHub Release tarballs only. Make the Linux plugin + stdio smoke run in CI (`smoke.mjs` against a headless daemon). Generic README paths. Docs site without personal name in examples (LICENSE/author fine).

**paseo-multi-account**
- `@getpaseo/client`/`plugin` → 0.17.x, `requirements.paseo` `>=0.17.0 <0.18` (C6). Linux credentials path test (`server/usage.ts`, `server/warmup.ts`). Drop `private: true` from the release tarball flow, tag `v1.1.0` with a GitHub Release artifact. Document the account contract (a Paseo provider entry `extends: "claude"` + `env.CLAUDE_CONFIG_DIR`, verified in `server/accounts.ts`) and expose the existing `server/login.ts` flow so agentbox can call it.

**hermes-paseo-bridge**
- Build from scratch (WP-BR-1): `plugin.yaml`/`__init__.py` per Hermes plugin guide, `bridge/` package, tests with a fake paseo-mcp, README in English, Apache-2.0 or MIT, release tarball `v0.1.0`.

**hermes-agent (fork)**
- No code changes. Archive the fork on GitHub, or leave it with a README note pointing to upstream. Check remote branches for any unique fork work once (`git log upstream/main..origin/<branch>` for non-upstream branch names), and list findings in ADR 0008.

---

## 14. [verify] spikes (do first, days 1–2, timeboxed)

| ID | Question | Method | Pass → | Fail → (decided fallback) |
|---|---|---|---|---|
| S1 | iroh-gateway v0.6.4 behind Caddy: WS + SSE + cookies through the native iroh-fetch client and through iroh-fetch WASM (desk-verified: env vars, SIGHUP reload, per-stream allow-list re-check, `X-Iroh-Remote-Id`, admin endpoints, stdout endpoint id) | Proxmox VM: gateway → Caddy → a hello app with WS; laptop `npx -p iroh-fetch@0.6.4 iroh-proxy <id> --port 8080`; browser test page | design as written | **already triggered (05):** the iroh-proxy CLI has no fixed-key option, so `agentbox connect` wraps `createIrohFetch({secretKey})` in its own local proxy |
| S2 | Hermes `v0.23.3` on Linux headless: install via `setup-hermes.sh --runtime-only` (pm, CPython 3.14, extras, venv location); `gateway run --replace --external-supervisor` under systemd; non-interactive `hermes auth add … --type api-key` (stdin) and `--type oauth --no-browser`; `config set` of `browser.cdp_url` and `platforms.webhook.extra.host`. (Desk-verified on v0.23.2: all CLI verbs and flags used in this plan exist; `gateway status` always exits 0.) | scripted install on VM, `hermes --help` dump into `spikes/S2.md` | use CLI verbs | direct YAML edits under a file lock while the gateway is stopped |
| S3 | Paseo 0.17.x headless on Linux: `paseo daemon run`, both plugins build and load, multi-account usage/switch with providers on Linux (desk-verified: config keys, `plugin install <dir>`, `/api/health`) | VM | as written | pin the newest version both plugins pass with. If plugin install from dir isn't supported: copy into `PASEO_HOME/plugins/<id>` + config entry |
| S4 | multi-account on Linux: two accounts via `claude auth login` with `CLAUDE_CONFIG_DIR` + provider entries, `.credentials.json` present, usage readout, switch, per-agent pin | VM with 2 Claude accounts | as written | setup-token per account (env per agent) with usage display disabled |
| S5 | Hermes plugin surface for the bridge (desk-verified: `pre_tool_call` `modify`, `ctx.spawn_task`, `ctx.inject_message(session_key=…)`, `ctx.call_mcp`). Remaining: is `bound_session_key()` set inside the tool-call thread, and does injection resume a Hermes-UI-originated (`local`) session | prototype | in-process plugin | bridge as a tiny sidecar process (same repo, Python) using the gateway WebSocket JSON-RPC like hermes-ui; label injection via paseo-mcp `_meta` defaults (Settings → Defaults → labels from `_meta`) |
| S6 | KasmVNC 1.5.x on noble: non-interactive first start (kasmpasswd, DE, yaml with `require_ssl: false`), loopback + no auth + openbox under systemd `-fg`; serving under `/browser/` behind Caddy (`handle_path`, WS path); Chromium on arm64 source | VM | path prefix | Caddy site `127.0.0.1:8082` for KasmVNC + gateway `IROH_ROUTES` host `browser.box`, and the config UI iframes `http://localhost:8082` on connect |
| S7 | Phone: KasmVNC JS client in the Hermes UI PWA with iroh-fetch WebSocket over relay; latency/usability on 4G | Android + iOS Safari | ship in v1 | phone uses the LAN URL. CDP screencast lite view in v1.1 |
| S8 | `agentbox connect`: can the Bun binary bundle iroh-fetch's WASM/native engine, or must it shell out to `npx`? | prototype | bundled (Bun loads N-API addons; check `--compile` embedding of the `iroh-fetch-<platform>` addon) | ship `agentbox connect` as a small Node script (`npx -y agentbox-connect`) using iroh-fetch@0.6.4 with `secretKey`; the stock `iroh-proxy` is not usable (no fixed key) |
| S9 | Headless device flows in a PTY (code + URL parse, Enter prompt, exit code): `gh auth login --web …`, `glab auth login --device …`, `claude auth login --claudeai` URL/code flow | node-pty/Bun PTY on the VM | parsers as designed | glab: PAT input card; claude: `setup-token` |
| S10 | Google + Slack hosted-MCP OAuth from the box's Chrome on a datacenter/LAN IP | VM | in-Chrome flow | paste-redirect-URL flow |

Spike results go to `agentbox/docs/spikes/S<n>.md` and update §4 pins in the manifest.

### 14.1 Desk-review status (2026-11-22, details in `05-review.md`)
- **Settled by reading real CLIs/sources:** Hermes tag (C4), gateway flags, CLI verbs for config/mcp/profile/webhook/auth/slack, `browser.cdp_url`, webhook bind default, plugin hooks/inject/spawn API (most of S5), Paseo config keys + plugin install from dir (most of S3), multi-account account contract (S4 registration part), iroh-gateway env/reload/admin/endpoint id (most of S1), iroh-proxy fixed-key gap (S1 fallback taken), KasmVNC flags and first-run behaviour (part of S6), gh/glab flags (part of S9).
- **Still need a VM:** S1 (WS/SSE/cookies end to end), S2 (install + extras + venv location), S3 (plugins on Linux), S4 (2 real accounts), S5 (session-key binding), S6 (path prefix + non-interactive start), S7, S8, S9 (PTY parsing), S10.
- **New spike-level unknown:** GitHub's remote MCP (`api.githubcopilot.com/mcp/`) with a `gh` OAuth token (`gho_…`); fallback is the stdio `github-mcp-server` with `GITHUB_PERSONAL_ACCESS_TOKEN` from `gh auth token`.

---

## 15. Work packages

Rules: each WP = one branch + PR in its repo, has tests and is mergeable on its own. "Test" lines are the commands CI or the reviewer runs. The VM e2e is `e2e/vm/acceptance.sh` (§16). Dependency arrows show the **minimum** order; everything else runs in parallel.

```
Day 1-2: S1..S10 (parallel)                 WP-AB-0 cleanup ─┐
Week 1:  WP-AB-1 ─► WP-AB-2 ─► WP-AB-3 ─► WP-AB-4           │
         WP-HUI-1, WP-HUI-2   WP-PM-1   WP-PMA-1   WP-BR-1   WP-CAT-1/2/3   WP-AB-5
Week 2:  WP-AB-6  WP-AB-7  WP-AB-8  WP-AB-9  WP-AB-10  WP-UI-1..3  WP-DOC-1  ─► WP-E2E-1 ─► v0.1.0
```

### agentbox repo (`~/Projects-private/agentbox`)

**WP-AB-0 Cleanup & ADRs** (no deps)
- Files: deletions in §13; `docs/adr/0008…0012`; `README.md`, `AGENTS.md` in English; `docs/implementation-plan.md` → pointer.
- AC: `rg -i "tailscale|cloudcli|metamcp|plane|paperclip|openhands" -g '!docs/adr/000[4-7]*'` returns nothing; build is green.
- Test: `bun install && bun run lint && bun run typecheck && bun run test && bun run boundaries`.

**WP-AB-1 Manifest + vendor installer** (deps: AB-0)
- Files: `manifest/components.yaml`, `packages/contract/src/manifest.ts` (zod), `packages/providers/src/host/vendor.ts` (download, sha256, extract to `/opt/agentbox/vendor/<c>/<v>`, symlink wrappers), `scripts/manifest-check.ts` (HEAD + sha check of all URLs).
- AC: every component in §4 has x64 + arm64 entries (or an explicit `arch: [x64]`). Re-running is a no-op. A wrong sha aborts with a clear error.
- Test: `bun test packages/providers/src/host/vendor.test.ts && bun scripts/manifest-check.ts`.

**WP-AB-2 Host providers + `agentbox up`** (deps: AB-1; S2, S3, S6 results)
- Files: `packages/providers/src/host/{users,dirs,apt,node,uv,hermes,hermes-ui,paseo,paseo-plugins,iroh,caddy,kasmvnc,chrome,firewall,units,claude-cli}.ts`, `templates/units/*.service`, `templates/Caddyfile.tmpl`, `apps/agentbox/src/main.ts` (`up`, `otp`, `reset-owner`, `doctor`, `host apply`, `secrets render`), `apps/agentbox/src/host/listen-detect.ts`.
- AC: on a fresh Ubuntu 24.04 VM, `sudo agentbox up` finishes in < 10 min with all health endpoints in §5.3 green and prints the first-run block. A second run reports only `noop`. `--listen local|lan` works. No port other than 8443 (lan mode) listens on non-loopback (`ss -tlnp`).
- Test: `bun test packages/providers` (detect/plan unit tests with fake exec) + `e2e/vm/acceptance.sh --stage up`.

**WP-AB-3 Auth: OTP, owner, sessions, forward_auth** (deps: AB-0)
- Files: `apps/agentbox/src/server/{auth.ts,otp.ts,forward-auth.ts}`, `packages/infra/src/db/schema.ts` (users, sessions, otp, devices, onboarding), migration, `apps/web/app/setup/`, `apps/web/app/login/`.
- AC: OTP is single use, expires at 60 min, is rate-limited (6th try/min → 429), `/setup` is 404 after claim. `/api/auth/check` returns 200 + `X-Agentbox-User` for a valid cookie or a known iroh id on the iroh listener, 401 otherwise. Spoofed `X-Iroh-Remote-Id` on :8080 is ignored. Passkey is shown only on secure origins.
- Test: `bun test apps/agentbox/src/server/auth.test.ts apps/agentbox/src/server/forward-auth.test.ts` + Playwright `e2e/browser/setup.spec.ts`.

**WP-AB-4 Devices + iroh gateway control + pairing** (deps: AB-3, S1)
- Files: `apps/agentbox/src/devices/{service,gateway-config}.ts`, `packages/contract/src/devices.ts`, `apps/web/app/(console)/devices/`, `apps/agentbox/src/main.ts` (`devices list|pair|revoke`).
- AC: no devices → gateway refuses all paths. Pairing opens the window, completes with the code, closes the window and allows only paired ids. Revoke disconnects on the next request. Hermes UI pairing calls this API. The endpoint id is stable across restarts.
- Test: `bun test apps/agentbox/src/devices` + `e2e/vm/acceptance.sh --stage iroh` (uses `agentbox connect` from the test runner).

**WP-AB-5 Browser units + config UI browser page** (deps: AB-2, S6)
- Files: `packages/providers/src/host/{kasmvnc,chrome}.ts`, `apps/web/app/(console)/browser/` (iframe `/browser/`, take-control toggle), `apps/agentbox/src/browser/lock.ts`, `catalog/skills/agentbox-browser/SKILL.md`.
- AC: `curl -s 127.0.0.1:9333/json/version` returns a Browser. The profile survives `systemctl restart agentbox-chrome` (a cookie set via CDP is still present). `/browser/` renders for an authed user and 401s otherwise. 9333 is not reachable via :8080/:8443.
- Test: `e2e/vm/acceptance.sh --stage browser`.

**WP-AB-6 `agentbox connect` (laptop)** (deps: AB-4, S8)
- Files: `apps/agentbox/src/connect/`, release targets `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`.
- AC: `agentbox connect <id> --code <c>` pairs once, persists the key, and afterwards `agentbox connect` serves `http://localhost:8080` with config UI, `/hermes/` and `/browser/` (WS) working.
- Test: `bun test apps/agentbox/src/connect` + acceptance `--stage iroh`.

**WP-AB-7 Onboarding backend: AI, Hermes config, MCP/skill install, Slack, OAuth** (deps: AB-2, CAT-1, S2, S4, S10)
- Files: `apps/agentbox/src/onboarding/{service,ai,hermes-config,install,slack,oauth}.ts`, `packages/contract/src/onboarding.ts`, `apps/agentbox/src/pty/{runner,parsers/claude}.ts`.
- AC: screens 2, 4, 5, 6 (OAuth + Slack + API key), 10 work against a real Hermes. Applying the `developer` bundle results in `hermes mcp list` (or config) showing paseo + GitHub connected and skills present on disk. Hermes restart is graceful. Secrets never appear in run logs (redaction test).
- Test: `bun test apps/agentbox/src/onboarding apps/agentbox/src/pty` + acceptance `--stage onboarding`.

**WP-AB-8 CLI device flows, SSH, repos** (deps: AB-2, S9)
- Files: `apps/agentbox/src/pty/parsers/{gh,glab}.ts`, `apps/agentbox/src/onboarding/{ssh,repos,git-identity}.ts`.
- AC: the gh card shows the code within 5 s, turns green after browser approval, and `gh auth status` exits 0 as `agentbox`. The ssh key is registered on GitHub. Selected repos clone in the background into `work/`.
- Test: parser fixture tests `bun test apps/agentbox/src/pty/parsers` + manual card in acceptance (`--stage clis`, needs a test GitHub account token in CI secrets for the API path).

**WP-AB-9 Profiles & SOUL generation** (deps: AB-7, CAT-1)
- Files: `catalog/soul/*.md`, `apps/agentbox/src/profiles/{compose,generate}.ts`, zod schema for the LLM output.
- AC: composition is deterministic (snapshot tests). Regeneration preserves user edits outside generated blocks. Invalid LLM JSON gets one retry, then a fallback to a role template. Created profiles answer `hermes -p <slug> chat -q "say ok"`.
- Test: `bun test apps/agentbox/src/profiles`.

**WP-AB-10 Webhook ingress** (deps: AB-2)
- Files: `apps/agentbox/src/webhooks/`, Caddy template blocks, `main.ts` (`webhooks expose|status`).
- AC: `agentbox webhooks expose cloudflared` prints a public URL. A signed test POST to `/webhooks/<route>` reaches Hermes and an unsigned one is rejected. `/`, `/hermes/` and `/browser/` return 404 via the public URL.
- Test: acceptance `--stage webhooks`.

**WP-UI-1/2/3 Config UI screens** (deps: AB-3; contract from AB-7/8/9) — can start against mocked oRPC
- Files: `apps/web/app/(onboarding)/{claim,ai,role,toolkit,soul,accounts,repos,agents,browser,apply}/`, `apps/web/app/(console)/{overview,devices,catalog,secrets,services,logs,settings}`, components in `packages/ui` (DeviceFlowCard, CatalogSearch, SoulEditor, RunDrawer, QrCode).
- AC: all screens in §8 incl. skip links and resume after reload. Keyboard + mobile layouts. No secret value ever rendered (lint rule + test). Lighthouse a11y ≥ 90.
- Test: `bun run --filter web test && bun run --filter e2e test` (Playwright against `agentbox dev` with mocked providers).

**WP-CAT-1 Curated catalog + bundles + agentbox skills** (no deps)
- Files: `catalog/items/*.yaml`, `catalog/bundles/*.yaml`, `catalog/skills/agentbox-*/SKILL.md`, `packages/contract/src/catalog.ts`.
- AC: 7 bundles + base, ≥ 60 curated items, all ids resolvable, licences set, no employer-specific items. Skills follow the agentskills spec.
- Test: `bun scripts/catalog-validate.ts`.

**WP-CAT-2 Catalog search service** (deps: CAT-1)
- Files: `apps/agentbox/src/catalog/{index,registry,anthropic-skills,hermes-builtin,rank}.ts`, `scripts/catalog-build.ts`.
- AC: autocomplete p95 < 50 ms on curated + cached data. Registry search works online and degrades silently offline. Results are deduped and tier-filtered.
- Test: `bun test apps/agentbox/src/catalog`.

**WP-CAT-3 Bundle CI** (deps: CAT-1, E2E-1) — schema job on every PR; nightly VM install of `developer` + `manager`.

**WP-REL-1 Release & installer** (deps: AB-0)
- Files: `.github/workflows/release.yml`, `scripts/install.sh`, minisign pubkey in `install.sh`, Pages publish for `get.agentbox.dev`.
- AC: tag `v0.1.0-rc.N` produces signed x64/arm64 binaries. `install.sh` refuses a bad signature, a non-24.04 OS and an unsupported arch.
- Test: `shellcheck scripts/install.sh && bats scripts/install.bats`.

**WP-DOC-1 Landing/Pages + docs** (deps: AB-0) — English README, quickstart (Proxmox), architecture page with every upstream repo and its role, security model, troubleshooting (`agentbox doctor`), out-of-scope list.

**WP-E2E-1 VM acceptance harness** (deps: AB-2; grows with each WP)
- Files: `e2e/vm/acceptance.sh`, `e2e/vm/proxmox-clone.sh` (clone from a cloud-init Ubuntu 24.04 template via `qm`), `e2e/vm/lib.sh`.
- AC: §16 passes end to end on Proxmox x64. Stages are runnable individually.

### hermes-ui repo
**WP-HUI-1 Cleanup + release** (no deps): §13 hermes-ui items except auth/base path; tag v0.3.0 tarball. Test: `npm run check && npm test && npm run test:ui`; `rg -i tailscale\|cloudflare src web/src README.md` is empty.
**WP-HUI-2 Agentbox integration** (deps: HUI-1, S1): `HERMES_UI_AUTH=proxy`, `HERMES_UI_BASE_PATH`, delegated pairing (`HERMES_UI_PAIRING_URL`), PWA `base` param, Browser tab (S7), systemd unit script. Files: `src/config.mjs`, `server.mjs`, `src/devices.mjs` (bypass in proxy mode), `web/src/lib/{api,backend}.ts`, `web/src/components/app/RemoteDialog.tsx`, `scripts/systemd-unit.mjs`. AC: works at `/hermes/` behind Caddy. The proxy header without the secret → 401. The PWA over iroh with `base=/hermes` loads the board and sends a prompt. Test: `npm test` (new `test/proxy-auth.test.mjs`, `test/base-path.test.mjs`) + acceptance `--stage hermes-ui`.

### paseo-mcp repo
**WP-PM-1** (deps: S3): pin Paseo 0.17.x, Linux CI with a headless daemon, release 0.5.0 (tarball; scoped npm optional), README cleanup. Test: `npm run build && npm test && node smoke.mjs`.

### paseo-multi-account repo
**WP-PMA-1** (deps: S3, S4): deps → 0.17.x, Linux credentials tests, add-account contract (CLI or HTTP route agentbox can call), release v1.1.0 tarball. Files: `package.json`, `paseo-plugin.json`, `server/{usage,warmup,stores}.ts`, `test/linux-credentials.test.ts`, README. Test: `npm run typecheck && npm test`.

### hermes-paseo-bridge repo
**WP-BR-1** (deps: S5; can start on a fake paseo-mcp immediately): plugin per §12.3. Files: `plugin.yaml`, `hermes_paseo_bridge/{__init__,hooks,events,deliver,store}.py`, `tests/`, `pyproject.toml`, README, LICENSE, release workflow. AC: a Paseo agent started from a Hermes session produces a follow-up message in **that** session on `turn.ended` within 10 s. A permission request shows up there. No event loss across a Hermes restart (cursor). Test: `uv run pytest` + acceptance `--stage bridge`.

---

## 16. End-to-end acceptance test (clean Proxmox VM)

`e2e/vm/acceptance.sh` runs from a workstation with `ssh`, `jq`, `node` (for the probe scripts) plus the `agentbox` binary (for `agentbox connect`) and a Proxmox API token. Interactive steps (OAuth consent, device codes, Claude login) use test accounts. In CI they are replaced by pre-seeded credentials via `--seed <dir>` (gh token, Claude creds dirs, Slack tokens). The script exits non-zero on the first failure and prints the stage.

```bash
#!/usr/bin/env bash
set -euo pipefail
VM=${VM:-agentbox-e2e}; SSH="ssh -o StrictHostKeyChecking=no ubuntu@$VM_IP"
stage(){ echo "== $1"; }

stage clone      # fresh VM from the Ubuntu 24.04 cloud-init template, 4 vCPU / 8 GB / 40 GB
./e2e/vm/proxmox-clone.sh "$VM"; VM_IP=$(./e2e/vm/proxmox-clone.sh --ip "$VM")

stage install
$SSH 'curl -fsSL https://get.agentbox.dev | sudo AGENTBOX_UP=1 sh' | tee up.log
grep -q 'Agentbox is running (9/9 services healthy)' up.log
OTP=$(grep -oP '#otp=\K[a-z-]+' up.log | head -1)
$SSH 'sudo agentbox up' | grep -q 'noop'                            # idempotent (WP-AB-2 AC: second run reports only noop)
$SSH "ss -tulnH | awk '{print \$5}'" | grep -vE '^(127\.0\.0\.(1|53|54)|\[::1\]|\[::ffff:127\.0\.0\.1\]):|:8443$' && exit 1 || true   # TCP+UDP; 127.0.0.53/54 = systemd-resolved

stage health
for u in 7777/healthz 8090/healthz 8787/api/health 6767/api/health 9333/json/version; do
  $SSH "curl -fsS http://127.0.0.1:$u >/dev/null"; done
$SSH 'systemctl is-active agentbox.target agentbox-{config,caddy,iroh,hermes,hermes-ui,paseo,kasmvnc,chrome}'
curl -sk -o /dev/null -w '%{http_code}' "https://$VM_IP:8443/browser/" | grep -q 401
curl -s -m 3 "http://$VM_IP:9333/json/version" && exit 1 || true   # CDP not exposed (CDP is plain http; an https probe would always fail)

stage claim      # API-level claim (UI covered by Playwright e2e/browser/onboarding.spec.ts)
JAR=$(mktemp)
curl -sk -c "$JAR" -X POST "https://$VM_IP:8443/api/setup/claim" -H 'content-type: application/json' \
  -d "{\"otp\":\"$OTP\",\"name\":\"E2E\",\"email\":\"e2e@example.com\",\"password\":\"$E2E_PASSWORD\"}" | jq -e .ok
curl -sk -o /dev/null -w '%{http_code}' "https://$VM_IP:8443/setup" | grep -q 404
curl -sk -X POST "https://$VM_IP:8443/api/setup/claim" -d '{}' -o /dev/null -w '%{http_code}' | grep -q 404

stage onboarding # drives the same oRPC calls the UI uses; --seed provides creds in CI
npx playwright test e2e/browser/onboarding.spec.ts --project=chromium \
  --grep "@vm" -- --base-url "https://$VM_IP:8443" --seed "${SEED:-}"   # roles=developer+manager, 2 Claude accounts, gh, ssh, 1 repo, 2 profiles
$SSH 'sudo -iu agentbox gh auth status' && $SSH 'sudo -iu agentbox ssh -T git@github.com' 2>&1 | grep -q 'successfully authenticated'
$SSH 'sudo -iu agentbox test -d ~/work/github.com/$E2E_REPO/.git'
$SSH 'sudo -iu agentbox jq -e "[.agents.providers[]|select(.extends==\"claude\")]|length>=2" ~/.paseo/config.json'   # accounts = claude-extending providers
$SSH 'sudo -iu agentbox hermes chat -q "Reply with the word READY"' | grep -q READY
$SSH 'sudo -iu agentbox hermes profile list' | grep -q reviewer

stage bridge     # orchestrator → Paseo agent → event back into the same session
SID=$($SSH 'sudo -iu agentbox agentbox api e2e.startDelegation --json' | jq -r .sessionId)   # asks Hermes to start a Paseo agent that writes hello.txt in the test repo
$SSH "sudo -iu agentbox agentbox api e2e.waitSessionMessage --session $SID --match '[paseo]' --timeout 300"

stage multi-account
$SSH 'sudo -iu agentbox agentbox api e2e.paseoSwitchAccount --to 2 --json' | jq -e .ok
$SSH 'sudo -iu agentbox agentbox api e2e.paseoAgentAccount --json' | jq -e '.account=="2"'

stage browser
$SSH 'curl -fsS http://127.0.0.1:9333/json/version | jq -e .Browser'
$SSH 'sudo -iu agentbox agentbox api e2e.cdpSetCookie --json' && $SSH 'sudo systemctl restart agentbox-chrome && sleep 5'
$SSH 'sudo -iu agentbox agentbox api e2e.cdpHasCookie --json' | jq -e .present
curl -sk -b "$JAR" -o /dev/null -w '%{http_code}' "https://$VM_IP:8443/browser/" | grep -q 200

stage iroh       # pair a laptop client, use full origin over iroh, revoke
P=$(curl -sk -b "$JAR" -X POST "https://$VM_IP:8443/api/devices/pair/start" | jq -c .)
ID=$(jq -r .endpointId <<<"$P"); CODE=$(jq -r .code <<<"$P")
agentbox connect "$ID" --code "$CODE" --port 18080 & CPID=$!; sleep 8
curl -fsS http://localhost:18080/api/me | jq -e .user
curl -fsS http://localhost:18080/hermes/api/health
node e2e/vm/ws-probe.mjs ws://localhost:18080/browser/websockify   # WS upgrade through iroh
DEV=$(curl -sk -b "$JAR" "https://$VM_IP:8443/api/devices" | jq -r '.[0].id')
curl -sk -b "$JAR" -X DELETE "https://$VM_IP:8443/api/devices/$DEV"
sleep 2; curl -s -o /dev/null -w '%{http_code}' http://localhost:18080/api/me | grep -qv 200; kill $CPID

stage hermes-ui  # PWA path: iroh-fetch over relay with base=/hermes
node e2e/vm/pwa-probe.mjs --endpoint "$ID" --base /hermes   # re-pairs, loads board, submits prompt, sees reply

stage slack-cron # optional with --seed slack
[ -n "${SEED_SLACK:-}" ] && $SSH 'sudo -iu agentbox hermes cron run e2e-ping' && node e2e/vm/slack-wait.mjs "e2e-ping"

stage webhooks
URL=$($SSH 'sudo agentbox webhooks expose cloudflared --json' | jq -r .url)
node e2e/vm/webhook-post.mjs "$URL/webhooks/e2e" --secret "$($SSH 'sudo -iu agentbox agentbox api e2e.webhookSecret')" | grep -q 202
curl -s -o /dev/null -w '%{http_code}' "$URL/webhooks/e2e" -X POST -d '{}' | grep -qE '401|403'
curl -s -o /dev/null -w '%{http_code}' "$URL/" | grep -q 404

stage voice
$SSH 'sudo -iu agentbox agentbox api e2e.ttsStt --json' | jq -e '.roundtrip==true'     # edge TTS → whisper STT

stage reboot     # everything comes back unattended
$SSH 'sudo reboot' || true; sleep 90
$SSH 'systemctl is-active agentbox.target' && $SSH 'sudo agentbox doctor --json' | jq -e '.fail==0'
echo "ACCEPTANCE PASSED"
```
`e2e.*` procedures exist only when `config.toml` has `[e2e] enabled = true` (set by `--seed`, never in releases' defaults).

**Manual checklist for the soft-launch sign-off (once, on Proxmox, real accounts):** claim via the LAN URL; run the full onboarding UI incl. gh device flow, Google login in the streamed Chrome, Gmail MCP OAuth, Slack app; pair the phone PWA and send a task from the phone; log in to a site from the laptop via `agentbox connect` `/browser/`; time TTFT (target < 10 min self-host incl. account logins).

---

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Hermes upstream moves fast (daily canaries, ~33.5k commits between `v2026.9.24` and `v0.23.3`, version scheme changed once already) | Config writes break | Pin a stable tag, wrap all Hermes calls in `onboarding/hermes-config.ts`, S2 snapshot of `--help`, nightly e2e before bumps |
| Bridge needs core hooks that don't exist | Must 3 slips | S5 fallback = sidecar via gateway WS (already proven by hermes-ui) |
| Claude subscription ToS for unattended / multi-account use | Account risk for users | Single-user box, ToS note in screen 2, API keys as the documented alternative |
| iroh-bridge is a small community project (1 maintainer) | Supply chain / bus factor | Pinned + sha-verified, MIT, small surface. Our gateway config is plain env so swapping to a fork is cheap. Track releases via Renovate |
| WASM iroh-fetch is relay-only → laggy VNC on phone | Poor phone browser UX | Laptop via `agentbox connect` on the native iroh-fetch engine (direct paths). Phone stream is S7-gated with the LAN fallback |
| Datacenter IPs/Chromium arm64 trigger bot checks, Google refuses login | Logins fail | Human logs in via the stream; Chrome on x64; doc note; residential proxy is v2 |
| PTY parsing of third-party CLIs breaks on output changes | Auth cards hang | Fixture tests per pinned CLI version, regex + timeout → "Open a terminal" fallback card (web terminal into the same PTY) |
| Single-origin cookie shared by all apps (XSS in one owns all) | Session theft | CSP per path in Caddy, HttpOnly + SameSite=Strict, proxy secret for Hermes UI, no third-party scripts |
| Local processes (agents) are root-equivalent over the box | Blast radius | Documented single-tenant model; :8081 uid firewall; no general sudo; CDP loopback only |
| Self-signed LAN cert confuses users | Drop-off at claim | Print fingerprint + explain; SSH tunnel alternative; passkey hidden there |
| 1–2 week timeline | Scope slip | Strict out-of-scope list; parallel WPs; spikes first; cut order: phone browser stream → webhooks `domain` mode → catalog registry live search → profile AI generation (template fallback) |
| Upgrades interrupt running agent turns | Lost work | v1: manual `agentbox update` only, warns if Paseo has active agents |

---

## 18. Out of scope for v1

- SaaS: signup, billing, VM provisioning, edge routing, the 7-day trial, own iroh relays (design hooks only, §19).
- Native mobile app (Expo/expo-iroh) and Tauri desktop app. The PWA is the phone client.
- Org features: sharing profiles/bundles across boxes (only the `shared_scope` column and `org_id` nullable FKs exist).
- Catalog cloud pipeline, signed snapshots, embeddings, PulseMCP/Smithery/Glama, ratings, telemetry-driven ranking.
- Per-server sandboxes for stdio MCPs (env scoping only).
- Auto-applied self-updates with rollback (v1: `agentbox update` manual with symlink switch; health-gated auto-rollback is v1.1).
- arm64 as a *tested* target (built and installable, but only Proxmox x64 is in the acceptance gate).
- Passphrase-sealed secrets / TPM `systemd-creds`; separate browser user.
- CDP-screencast lite view, neko/WebRTC, audio in the stream.
- Exposing Paseo's own web UI or relay; Paseo desktop app.
- Docker/container workloads, devcontainers, per-repo env provisioning beyond the optional `agentbox-repo-setup` agent task.
- Mac-only capabilities (Apple apps, computer-use on macOS) and any of Max's personal scripts/crons/MCPs.
- Multi-user boxes, RBAC.
- Telemetry (only the event hook; default off).

---

## 19. Design hooks for the cloud version (no implementation in v1)

- `agentbox up --claim-token <jwt>`: cloud-init passes a pre-claim token and the owner identity, so the OTP/claim screen is skipped (`users.external_id`, `auth_provider`).
- `agentbox up --trusted-device <nodeId>`: pre-seeds the SaaS edge as a device (`devices.kind = 'edge'`). Edge-injected identity = a signed JWT header verified by forward_auth (`config.toml [edge] jwks_url`).
- `config.toml [iroh] relay_url/relay_token` already supported for own relays.
- `manifest/components.yaml` + `agentbox up` are the image-bake step for prebuilt VM images (Packer later).
- Secrets: `agentbox secrets import --age-recipient` accepts control-plane-encrypted bundles.
- Trial credits: provider `agentbox-trial` slot in the AI step (hidden unless `[cloud] enabled`).
- Profiles/bundles carry `org_id` (nullable) and `shared_scope` for later org sharing.
