# 04 — Remote Browser Login, Access & Runtime Architecture (v1)

Status: proposal. Opinionated v1 choices; anything marked **[verify]** has to be checked against current upstream docs before we build on it.

---

## TL;DR decisions

| Area | v1 choice | Why |
|---|---|---|
| Streamed browser | **KasmVNC** (Xvnc + web client) hosting one **real Chrome** with a persistent profile and `--remote-debugging-port=9333` | Uses a single HTTP/WebSocket port, so it works through any TCP/HTTP tunnel, including iroh. Full-fidelity desktop (popups, 2FA, file pickers, extensions). Agents and the human share the same Chrome at once. |
| Fallback / later | CDP `Page.startScreencast` "lite view" inside the Hermes UI (for phones) | No extra daemon, but input fidelity is weaker. Add it later as a convenience, not as the main login path. |
| Rejected for v1 | neko (WebRTC), Xpra, browserless/Steel/Browserbase | neko needs UDP or TCP-mux plus ICE, which goes badly through iroh streams. Xpra's HTML5 client is clunkier. browserless/Steel are built for ephemeral headless sessions or are SaaS, which is wrong for a persistent, self-hosted login. |
| Edge | One local reverse proxy (**Caddy**, bound to 127.0.0.1:8080) gives a single origin with paths `/` (config UI), `/hermes/`, `/browser/`, `/paseo/` | Same origin means one auth cookie and one tunnel target. |
| Remote access | **`agentbox-gw`**: a small Rust daemon embedding an **iroh** endpoint that pipes incoming streams to 127.0.0.1:8080. Pairing by QR/ticket. | Fits the iroh-only constraint. Hermes UI pairing is already iroh. |
| First run | One-time password (OTP) printed on the console/cloud-init log, plus an SSH port-forward to the local port | No public ports. |
| SaaS routing | `https://<box-id>.agentbox.<tld>`: our edge terminates TLS, then dials the box over iroh using its NodeId | No inbound ports on customer VMs. |
| Process model | systemd system units, dedicated `agentbox` user, `/opt/agentbox` (immutable releases) + `/var/lib/agentbox` (state) | Idempotent, upgradable, rollbackable. |
| Claude login | `claude setup-token` (long-lived OAuth token) run on the laptop **or** in the box terminal, then stored as `CLAUDE_CODE_OAUTH_TOKEN` | No browser on the VM needed. |
| Codex login | Device-code login (`codex login --device-auth` **[verify]**), fallback: copy `~/.codex/auth.json` or API key | Headless-friendly. |

---

## 1. Streamed browser

### Requirements
1. Real Chrome (not headless) with a **persistent profile**, so logins survive restarts.
2. **CDP on 9333** for agents (`browser-harness`, same as on the Mac), while
3. a human can watch and control the **same** instance from a laptop or phone to log in, solve captchas or do 2FA.
4. The transport has to traverse an **iroh stream**, i.e. one TCP-ish byte stream per connection. No UDP, no extra ports.

### Options compared

| Option | Transport | Through iroh? | Fidelity | Persistent profile + CDP | Verdict |
|---|---|---|---|---|---|
| Xvfb + x11vnc + noVNC/websockify | WS over HTTP | ✅ | Good | ✅ (Chrome on Xvfb) | Works, but needs 3 moving parts. Fine fallback. |
| **KasmVNC** | WS over HTTP, single port, built-in web client, clipboard, dynamic resize, basic auth | ✅ | Good, also decent on mobile | ✅ (Chrome on its Xvnc display) | **Pick.** One process replaces Xvfb+x11vnc+noVNC. |
| Xpra HTML5 | WS | ✅ | Per-window, quirky | ✅ | Not worth the complexity. |
| neko (m1k1o) | WebRTC (UDP; TCP mux option) | ⚠️ Possible only with TCP mux and ICE candidate hacks | Excellent (video+audio) | ✅ but ships its own Chrome container | Revisit for v2 if smooth video matters. |
| CDP screencast (`Page.startScreencast` + `Input.dispatch*`) | WS (CDP) | ✅ | Viewport only: no browser chrome, no native dialogs, weak IME, multi-tab handling is manual | ✅ (is CDP) | Good **lite viewer** in Hermes UI later. Not reliable enough for login flows. |
| browserless (self-host) | CDP/WS + live URL | ✅ | Built for ephemeral headless sessions | Partial | Wrong model. |
| Steel / Browserbase live view | Their cloud | ❌ (SaaS) | Good | Their profiles | Conflicts with self-hosted and privacy goals. |

### v1 layout
```
agentbox-kasmvnc.service   Xvnc :1 (KasmVNC), websocket on 127.0.0.1:6901, no own TLS (Caddy in front)
agentbox-chrome.service    DISPLAY=:1 google-chrome (x64) | chromium (arm64)
                           --user-data-dir=/var/lib/agentbox/chrome-profile
                           --remote-debugging-address=127.0.0.1 --remote-debugging-port=9333
                           --no-first-run --no-default-browser-check --disable-dev-shm-usage
                           (Restart=always, After=agentbox-kasmvnc)
Caddy  /browser/*  → 127.0.0.1:6901 (WS upgrade)   [auth: agentbox session cookie]
```
- **arm64:** Google ships no Chrome for linux-arm64. Use Chromium on arm64 (Ubuntu's chromium is snap-only; prefer a deb from a maintained source **[verify]**, or Playwright's Chromium build). Expect slightly different site fingerprinting. Document this.
- Run a minimal window manager (e.g. `openbox`) so popups and OAuth windows behave, and keep Chrome maximized.
- CDP stays **loopback-only**. Never expose 9333 via Caddy. CDP access is root-equivalent over every logged-in account.
- Configure the KasmVNC resolution to follow the client (dynamic resize) so phones work in portrait.
- **Profile lock:** exactly one Chrome per profile dir. Agents must *attach* via CDP and never launch their own Chrome. browser-harness is configured with `cdp_url=http://127.0.0.1:9333`.
- **Human/agent conflict:** the config UI shows a "Take control" toggle that sets a flag the agents read (best effort) to pause browser actions while the human is logging in.

---

## 2. Access model

### 2.1 Single origin
Caddy listens on `127.0.0.1:8080` only:
- `/` → agentbox config UI (also the auth/login endpoint and the session issuer)
- `/hermes/` → Hermes UI
- `/browser/` → KasmVNC
- `/paseo/` → Paseo UI/API (if exposed)

Auth is a `forward_auth` to the config UI. That gives one session cookie (`HttpOnly; SameSite=Strict`) for all apps. Every app must tolerate a path prefix, or get its own sub-port vhost if it can't **[verify Hermes UI base-path support]**.

### 2.2 First run (no public ports)
1. `agentbox up` finishes and prints, to the console, `/var/lib/agentbox/first-run.txt` (mode 0600) and the cloud-init log:
   - a **one-time password** (random, 128-bit, valid 24 h or until used)
   - `ssh -L 8080:127.0.0.1:8080 user@vm` → open `http://localhost:8080`
   - an **iroh pairing QR** (ASCII) plus a ticket string
2. The first login with the OTP forces you to create an admin passphrase or a passkey (WebAuthn works on `localhost`). The OTP is then burned.
3. Proxmox case: the user can also open the console in a browser on the LAN with `agentbox up --listen-lan` (opt-in, binds 0.0.0.0, self-signed TLS). Off by default.

### 2.3 iroh pairing (steady state)
- `agentbox-gw` has a persistent iroh secret key at `/var/lib/agentbox/iroh/secret.key`, so the NodeId is stable.
- Pairing ticket = NodeId + relay URL + short-lived **pairing secret**. Shown as a QR in the config UI ("Add device").
- A device presents the pairing secret once, and the box stores the device's NodeId in an allowlist (`devices.json`). Afterwards the gateway accepts connections **only from allowlisted NodeIds** (iroh authenticates peers by key). Revoke = remove the NodeId.
- ALPN `agentbox/http/1`: every bi-stream is piped raw to 127.0.0.1:8080 (HTTP/1.1 + WebSocket just work). Hermes UI's existing iroh pairing can either keep its own ALPN or later be folded into this gateway, so there's one pairing for everything. **Recommend folding** (one QR, one allowlist).
- **Clients:**
  - *Phone:* the Hermes mobile app (already speaks iroh) opens a WebView against a local in-app proxy, giving the full UI including `/browser/`.
  - *Laptop:* `agentbox connect` (tiny binary, same Rust crate) listens on `localhost:8080` and forwards over iroh, so the user opens `http://localhost:8080` in a normal browser. This is the dumbpipe pattern.
  - *Pure browser, nothing installed:* not possible directly (iroh-in-wasm is relay-only/experimental **[verify]**). That's what the SaaS edge solves.
- iroh uses n0's public relays by default. Self-hosting `iroh-relay` is a v2 item (needed for SaaS anyway).

### 2.4 Cloud SaaS routing
```
browser ──TLS──> edge.agentbox.<tld> (wildcard *.box.agentbox.<tld>, our Rust/Caddy edge)
                 ├─ authenticates user (our account system, OIDC)
                 ├─ maps <box-id> → box NodeId (from control plane DB)
                 └─ iroh connect(NodeId, ALPN agentbox/http/1) ─► agentbox-gw ─► Caddy :8080
```
- The edge node is itself a paired "device" (its NodeId is in the box allowlist and added at provisioning via cloud-init). Customer VMs need **zero inbound ports** (outbound UDP/HTTPS to relays only).
- Box-level auth stays on as defense in depth: the edge injects a signed identity header (JWT signed by the edge key, verified by the config UI).
- Running our own iroh relays in the same regions as the VMs cuts latency for the browser stream.
- The edge sees plaintext HTTP, so SaaS users trust us with session traffic. Document this, and offer "direct iroh only" mode for privacy-sensitive users.

---

## 3. Process model

### 3.1 Users & dirs
| Path | Owner | Purpose |
|---|---|---|
| `/opt/agentbox/releases/<ver>/` | root, ro | binaries, UI bundles, unit templates |
| `/opt/agentbox/current` → symlink | root | active release (atomic switch) |
| `/etc/agentbox/config.toml` | root:agentbox 0640 | non-secret config |
| `/etc/agentbox/secrets.env` | root:agentbox 0640 (v1) | tokens (see 3.4) |
| `/var/lib/agentbox/` | agentbox | state: chrome-profile, iroh keys, devices.json, hermes, paseo data |
| `/home/agentbox` | agentbox | `$HOME` for claude/codex/hermes CLIs (`~/.claude`, `~/.codex`) |
| `/var/log/agentbox/` | journald preferred | |

- A single unprivileged `agentbox` user runs everything except Caddy, which also runs unprivileged since it binds a high port. Agents can run arbitrary code as `agentbox`, so treat the box as a single-tenant blast radius. Don't give sudo; package installs go through `agentbox` helper verbs with a narrow sudoers rule.
- Optional v2: separate `agentbox-browser` user so agent code can't read the Chrome profile directly (it still has CDP, so the gain is small).

### 3.2 systemd units (all `agentbox-*.service`, grouped by `agentbox.target`)
| Unit | Notes |
|---|---|
| `agentbox-gw` | iroh gateway. `Restart=always` |
| `agentbox-caddy` | edge proxy on 127.0.0.1:8080 |
| `agentbox-config` | config UI + auth + update API |
| `agentbox-hermes` | Hermes agent daemon |
| `agentbox-hermes-ui` | Hermes UI |
| `agentbox-paseo` | Paseo daemon |
| `agentbox-kasmvnc` | display :1 |
| `agentbox-chrome` | `BindsTo=agentbox-kasmvnc` |
| `agentbox-update.timer` | daily update check (download only; applies when policy allows) |

Use hardening where it doesn't break agents: `NoNewPrivileges=yes`, `ProtectSystem=strict` + `ReadWritePaths=/var/lib/agentbox /home/agentbox` for gw/caddy/config. Agent-runner units (hermes/paseo) stay looser because they run arbitrary toolchains. Logs go to journald, and the config UI tails them.

### 3.3 Install, idempotency, updates
- `curl -fsSL https://get.agentbox.<tld> | sh` → detects arch (`uname -m`: x86_64/aarch64), checks Ubuntu 24.04, downloads the signed `agentbox` static binary (Rust or Go, **minisign/cosign** signature verified against a pinned key), and puts it in `/usr/local/bin`.
- `agentbox up` = **declarative converge**: desired state comes from a manifest embedded in the release (apt packages, users, dirs, units, versions of Paseo/Hermes/Hermes UI). Each step is check-then-act, so re-running is safe and also serves as "repair". No Ansible dependency; keep it in-binary.
- Third-party components (Paseo, Hermes, Hermes UI, KasmVNC deb, Node runtime) are **pinned versions with checksums** in the release manifest. Never install "latest" at runtime.
- **Self-update:** `agentbox update` downloads the release, verifies the signature, unpacks to `releases/<ver>`, runs migrations, switches the `current` symlink, restarts units, and health-checks `/healthz` for all units within 60 s. If that fails, it **rolls back the symlink automatically**. Keep the last 3 releases. Channel: `stable|beta` in config.
- The Chrome/Chromium update path is apt (unattended-upgrades for Chrome's repo). A restart of `agentbox-chrome` is scheduled when no agent session is active.

### 3.4 Secrets
- v1: `/etc/agentbox/secrets.env` (0640 root:agentbox), loaded via `EnvironmentFile=`. Holds `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, etc. Edit only via config UI or `agentbox secret set`, and never write to logs.
- iroh secret key: 0600 agentbox.
- v2: `systemd-creds` (TPM-bound where available) or encrypt at rest with a key derived from the admin passphrase. For SaaS: secrets pushed from the control plane, encrypted to the box key.
- The Chrome profile is effectively the most sensitive secret (all sessions). It should be included in backups, encrypted.

---

## 4. Claude / Codex login on a headless VM

### Claude Code
- **Recommended:** run `claude setup-token` (on the laptop or in the box terminal via the config UI web terminal). It prints an OAuth URL; the user authorizes in any browser and pastes back the code, which yields a **long-lived token**. Store it as `CLAUDE_CODE_OAUTH_TOKEN` in `secrets.env`. Paseo/Hermes-spawned `claude` processes inherit it. **[verify token lifetime, ~1 year at time of writing, and which subscription plans it supports]**
- Alternative: interactive `claude` → `/login` in the web terminal (URL + paste-code flow works headless) writes `~/.claude/.credentials.json`. Works, but refresh behavior on a box is less predictable than with setup-token.
- API key (`ANTHROPIC_API_KEY`) is also supported for pay-as-you-go users.
- Config UI wizard: the "Connect Claude" button runs `setup-token` in a PTY, shows the URL as a link/QR, and has a paste box for the code. Done.

### Codex
- Preferred: **device-code auth** (`codex login --device-auth` **[verify flag and availability on current Codex CLI]**). Show the code and URL in the wizard.
- Fallback: the user runs `codex login` on the laptop and uploads `~/.codex/auth.json` through the config UI (stored at `/home/agentbox/.codex/auth.json`, 0600). Or use an API key: `codex login --with-api-key` / `OPENAI_API_KEY`.
- Last resort: run the localhost-callback login through the streamed Chrome on the box, since the callback hits the box's own localhost. This works because KasmVNC Chrome lives on the box: a neat universal fallback for *any* CLI with a localhost OAuth callback.

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Datacenter IPs + Chromium/arm64 cause bot detection or captchas, and Google login refuses | Logins fail or get flagged | Human logs in via the stream (captchas solvable). Prefer Google Chrome on x64. Document that some sites will flag cloud IPs; v2: optional residential egress proxy per profile. |
| CDP = full account takeover if exposed | Critical | 9333 loopback-only, never proxied. Box auth on `/browser/`. Allowlisted iroh NodeIds only. |
| Session cookie theft via proxied apps on the same origin (XSS in any one app owns all) | High | CSP per path. Consider per-app subdomain vhosts on the SaaS edge in v2. |
| Hermes UI / Paseo don't support a base path | Blocks single origin | Fallback: separate local ports, with the iroh gateway multiplexing by ALPN (`agentbox/http/hermes`) and the client proxy mapping each to its own localhost port. |
| iroh relay dependency (n0 public relays) | Outage blocks remote access | Direct hole-punching usually works. Self-host `iroh-relay` for SaaS. SSH fallback is always documented. |
| VNC over relayed iroh feels laggy on mobile | Poor UX | KasmVNC quality/JPEG tuning, lower resolution on mobile. v2: CDP-screencast lite view or neko with TCP mux. |
| Self-update breaks a box remotely | Box lost | Signed releases, health-gated with automatic rollback, staged channels, `agentbox repair` via SSH. |
| Agents and human fight over the same Chrome | Flaky logins | "Take control" pause flag. Agents open their own tabs and never close the human's. |
| Chrome profile corruption on hard kill | Lost logins | `KillSignal=SIGTERM`, `TimeoutStopSec=30`, nightly profile snapshot (rsync while Chrome is quiescent, or btrfs/zfs snapshot on Proxmox). |
| Claude subscription ToS for unattended/shared use | Account risk | Single-user box only. Surface the ToS note in the wizard. Team/SaaS uses API keys. |

---

## 6. v1 build order
1. `agentbox up` converge: user, dirs, Caddy, config UI with OTP auth.
2. KasmVNC + Chrome units, browser-harness attach to 9333, verified via SSH tunnel.
3. Claude/Codex wizard (PTY-backed).
4. `agentbox-gw` iroh gateway + `agentbox connect` laptop client + QR pairing and allowlist.
5. Fold Hermes UI pairing into the gateway. Mobile WebView.
6. Signed self-update with rollback. arm64 CI matrix (Proxmox x64 first, then a Hetzner CAX arm64).
7. SaaS edge + control-plane provisioning (Hetzner/AWS API, cloud-init passes the edge NodeId).
