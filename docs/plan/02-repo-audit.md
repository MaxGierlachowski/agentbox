# 02 – Repo audit (read-only, 22.11.2026)

Target: `agentbox` CLI on a clean Ubuntu VM installs and wires Paseo (+multi-account, paseo-mcp), Hermes (+bridge) and Hermes UI. Remote access only via iroh. A separate agentbox config UI handles onboarding, then hands off to Hermes UI.

## Summary table

| Repo | State | Install today | Linux/headless | Releases | Main gap |
|---|---|---|---|---|---|
| agentbox | Walking skeleton, 3 commits; plan/ADRs in German | `bun build --compile` single binary (not released) | Built for Ubuntu 24.04 + systemd, but tied to Tailscale | none (changesets configured) | Tool stack (CloudCLI/MetaMCP/Plane/Tailscale) must go; no Paseo/Hermes providers |
| hermes-ui | Mature backend + shadcn PWA; Expo/Tauri app on unmerged branches (PR #9/#10) | `git clone && npm i && node bin/hermes-ui.mjs serve`; not on npm | Backend is portable Node ≥24, iroh-gateway has linux x64/arm64 builds; service setup is **launchd only** | tags `mobile-app-v0.x`, `desktop-spike-*`; pkg 0.2.0 | No npm/tarball release, no systemd unit, multiple remote modes incl. Tailscale |
| hermes-paseo-bridge | **Empty**: one-line README, "Initial commit" | – | – | none | Code doesn't exist yet (or lives somewhere else, e.g. in the hermes-agent fork or hermes-ui) |
| paseo-mcp | Usable, v0.4.0, CHANGELOG, tests, push events | npm package `paseo-mcp` (bin) or Paseo plugin (`paseo-plugin.json`) | Yes (Node, stdio/HTTP) | semver + CHANGELOG; check whether it's on npm | Pin against @getpaseo version; README example path `/Users/me` |
| paseo-multi-account | Usable plugin v1.0.0, `private: true` | Paseo plugin install from source | **Partly Mac-only**: usage/credentials read the macOS Keychain (`security`); has a `darwin` guard with a file fallback (`~/.claude/.credentials.json`) | no tags | Verify the Linux file path end to end; @getpaseo 0.12.0 vs 0.15.0 in hermes-ui |
| hermes-agent | Fork of NousResearch | `setup-hermes.sh` (uv/Python + pnpm), Docker, nix | Upstream supports Linux | upstream tags `v2026.9.x` | Local `main` is **6700 commits behind upstream, 0 ahead**. Fork changes are only on branches (if any) |

## 1. agentbox (`~/Projects-private/agentbox`)
- **Purpose/state:** Bun/Turbo monorepo. `apps/agentbox` (Hono+oRPC server, runs, tools, automation), `apps/web` (Next.js static export, embedded), `packages/{contract,infra,ui}`, plus e2e, landing and a GitHub Pages site. Implementation plan v1 (23.09., German) and ADR 0001–0007.
- **Reuse:** monorepo/tooling (biome, turbo, lefthook, depcruise, renovate, changesets); `scripts/compile.ts` (single binary with embedded UI); `server/{app,static,auth,router,start}.ts`; `packages/contract` (oRPC + event iterator with `lastEventId` resume); `infra/db` (bun:sqlite + Drizzle + generated migrations); `infra/secrets` (age store, sealed start/unlock); `infra/fs/atomic.ts`; `runs/service.ts` (run log/events); `packages/ui` design system; the plan/apply/verify provider model and the unlock/login pages from the plan.
- **Delete/rewrite:** `src/automation/service.ts` (Plane→CloudCLI automation), `src/tools/*` + `contract/tools.ts` + `app-cards`/`app-icons` (CloudCLI/MetaMCP/Plane cards), `runs/demo.ts`, `infra/docker` (only if no container workloads stay), Tailscale login/`tailscale serve` socket approach. Mark ADR 0004, 0005, 0006 and 0007 as superseded. Write new ADRs for iroh access, Paseo+Hermes stack and the onboarding flow. Rewrite plan §1/§3 (topology).
- **Missing for unattended install:** host providers for Node 24, uv/Python, Paseo CLI + systemd, Hermes + gateway service, Hermes UI + systemd, plugin installs, agent CLIs (claude/codex/gh) with a guided auth flow, SSH key generation, repo cloning, iroh pairing; a `curl | sh` installer and GitHub release artifacts (linux x64/arm64).
- **Personal refs:** LICENSE (name only, fine). Plan text is German → translate for OSS.

## 2. hermes-ui (`~/Projects-private/hermes-ui`)
- **Purpose:** Kanban/Inbox for Hermes sessions. Headless Node backend (`server.mjs`, `src/*`) talks to the Hermes gateway over WebSocket and reads Paseo via paseo-mcp events and `@getpaseo/client`. Also Web Push (VAPID/FCM), approvals, and the PWA in `web/`. Expo app `mobile-app/` (renamed to `app/` on the branch) has a native `expo-iroh` module. Tauri desktop app lives on `hermes/universal-spike`.
- **State:** `main` lags behind; the newest work is in draft PRs #9 → #10 (merge order matters). HANDOFF.md is a German personal note and should go in the OSS repo. The local-only branch `archive/pre-publish` contains personal paths and can be deleted.
- **Install:** clone + `npm install` (postinstall builds `web/`) + `serve`. Only service helper is `scripts/launchd-plist.mjs` (`~/Library/LaunchAgents`, `~/Library/Logs`) → **add a systemd user/system unit**. Not published to npm.
- **Remote modes:** `off | iroh | tailscale-funnel | tailscale-serve | cloudflare` → reduce to `off | iroh` for agentbox.
- **Personal refs to check:** `src/local-files.mjs`, `test/*.test.mjs`, `web/e2e/fixtures.ts`, README (hits for `/Users/…`/name; the GitHub Pages URL `maxgierlachowski.github.io/hermes-ui/app/` is the default `HERMES_UI_URL` used in pairing links → make it configurable/self-hosted).
- **How iroh pairing works** (`src/iroh.mjs`, `src/devices.mjs`):
  - The backend downloads `iroh-gateway` (irohkit/iroh-bridge releases, SHA-256 verified; darwin/linux, x64/arm64) and runs it as a child process in front of `127.0.0.1:<port>`.
  - The persistent key in `<data>/iroh/gateway.key` gives a stable endpoint id. It uses the n0 relays by default; `IROH_RELAY_URL` sets your own relay.
  - Browsers reach it with **iroh-fetch (WASM)** through the relay, E2E encrypted, no open port. The app uses native `expo-iroh`.
  - `hermes-ui pair` opens a pairing window and prints a QR/link (UI URL + endpoint id + code). During that window the gateway admits everyone, but the server only accepts the pair call. Paired device ids go into `IROH_ALLOW_CLIENTS` (hot-reloaded via SIGHUP).
  - Every request carries `X-Iroh-Remote-Id`, which the server checks again.
- **Could it tunnel the agentbox config UI / a remote browser?**
  - **Config UI: yes, with work.** The gateway is a generic HTTP reverse proxy, but it is locked down today: `IROH_ALLOW_PATHS=/api` and a single `BACKEND_URL`. Options: (a) agentbox runs its own iroh-gateway instance with its own key and the same pairing pattern; (b) one shared gateway in front of a small agentbox router that dispatches `/api/hermes-ui/*` and `/api/agentbox/*` and shares one device registry. (b) gives one pairing for both UIs and fits the "agentbox onboarding → hand-off to Hermes UI" flow.
  - The UI itself stays static (hosted or served locally) and only the API goes through iroh-fetch. So the agentbox UI must also call its API through iroh-fetch, not through plain same-origin fetch.
  - **Remote-browser stream: unclear/likely not as-is.** iroh-fetch is request/response HTTP. WebSocket/streaming support in iroh-gateway needs checking; a video/CDP stream (e.g. noVNC/CDP screencast) would need either WS passthrough or a native iroh stream (QUIC; feasible in the Expo app via `expo-iroh`, harder in a browser). Needs a spike.

## 3. hermes-paseo-bridge (`~/Projects-private/hermes-paseo-bridge`)
- Only `README.md` ("Paseo agent events continue the Hermes session that started the agent"). No code, no plugin manifest. Either it still needs to be built or the logic lives elsewhere (hermes-ui `paseo-calls.mjs`/`paseo-mcp-source.mjs` and paseo-mcp's push events/webhooks with "caller references" cover parts of it). **Biggest missing piece in the stack.**

## 4. paseo-mcp (`~/Projects-private/paseo-mcp`)
- MCP server (stdio, or Streamable HTTP as a Paseo plugin) to list/read/start/steer Paseo agents; push events with generic webhook signatures. v0.4.0, Apache-2.0, CHANGELOG, tests, `smoke.mjs`, docs site.
- Linux-ready (pure Node). Install via `npm i -g paseo-mcp` (check that it's published) or as a Paseo plugin; agentbox must register it in Hermes MCP config and wire the webhook → bridge/Hermes UI.
- Cleanup: README example `/Users/me` (generic, OK); `docs/index.html` contains the name.

## 5. paseo-multi-account (`~/Projects-private/paseo-multi-account`)
- Paseo plugin: several Claude logins behind one provider, one-click switch (separate `CLAUDE_CONFIG_DIR`s). v1.0.0, `private: true`, no tags/releases.
- **Mac assumptions:** `server/usage.ts` and `warmup.ts` read credentials from the macOS Keychain via `security`, with a `process.platform !== 'darwin'` fallback to the credentials file. Linux should work via `.credentials.json` but this is untested headless. Guided `claude login` per account on a headless VM (device-code/URL flow) needs to be driven from the agentbox UI.
- Version skew: `@getpaseo/client`/plugin 0.12.0 vs 0.15.0 in hermes-ui → align to one pinned Paseo version.
- README example `/Users/you` (fine).

## 6. hermes-agent (`~/Projects-private/hermes-agent`)
- Fork (`origin` MaxGierlachowski, `upstream` NousResearch). Huge Python project + pnpm workspace (web, TUI, desktop). Linux install via `setup-hermes.sh`, Docker/compose, nix flake; tags up to `v2026.9.24`.
- Local `main` = 0 commits ahead of upstream and 6700 behind → there's no fork-specific code on main. **Recommendation:** install upstream releases (pinned tag) unless the bridge needs core patches; put customization in plugins/skills/config. Check remote branches for any fork work before deciding.
- Hermes gateway service on Linux: upstream supports `hermes gateway` as a systemd service. agentbox should call that, not reimplement it.

## Paseo on Linux (from paseo.sh/docs + exe.dev recipe)
- `npm install -g @getpaseo/cli` (Node 24, e.g. NodeSource) → `paseo daemon run`. State is in `PASEO_HOME` (`~/.paseo`).
- Config: `paseo daemon config set daemon.listen 127.0.0.1:6767`, `features.webUi.enabled true` (the daemon can serve the web UI), optional `PASEO_PASSWORD` via EnvironmentFile.
- systemd unit: `ExecStart=/usr/bin/paseo daemon run`, `Restart=always`. Health check: `curl localhost:6767/api/health`.
- Pairing: `paseo daemon pair --relay` (Paseo's own E2E relay + QR). For "iroh only", **keep Paseo bound to localhost and disable its relay**, and reach Paseo only through Hermes UI/paseo-mcp (or proxy it behind the iroh gateway).
- Update: `npm i -g @getpaseo/cli@<pin>` + restart (this interrupts running agent turns).

## Cross-cutting cleanup
- Remove every Tailscale path: agentbox ADR 0004/plan, hermes-ui remote modes, Paseo TCP/Tailscale suggestions.
- Translate German docs/HANDOFF for OSS. Remove the personal handoff and `archive/pre-publish`.
- A grep for employer references found **no hits** in any of the 5 own repos. Name hits are only in LICENSE files, README examples and the Pages docs.
- Pin versions in one agentbox manifest: Paseo CLI, @getpaseo/*, paseo-mcp, multi-account, Hermes tag, hermes-ui, iroh-gateway, Node 24, uv.
- Every component needs a release artifact so the install runs unattended: hermes-ui (npm or tarball), multi-account (tagged release), bridge (exists only as a README).
