# 01 — Benchmark: Max's Mac agent setup (inventory, read-only, 2026-11-22)

Scope: what exists today on the Mac and must be reproducible by Agentbox on a clean Ubuntu VM.
No secret values recorded — only names/kinds. Employer-specific items are named generically ("company MCPs").

## 1. Component inventory

| Area | Mac state |
|---|---|
| Hermes agent | `~/.hermes/hermes-agent` (bin via `.hermes/bin/hermes`), `config.yaml` (_config_version 53), model provider `anthropic`, default `claude-opus-5-5`; gateway daemon (gateway.sock/pid), state.db, kanban.db, memories/, sessions/, vault (`vault.json.enc` + `vault.key`), auth.json |
| Hermes profiles | `profiles/{data,infra,support}` each with own `SOUL.md`, config.yaml, skills/, memories/, cron/, plugins/; same model as default |
| Bot role templates | `~/.hermes/bots/`: `soul-base.md`, `role-{default,data,infra,support}.md` (composed into profile SOULs); `bot_relay/` |
| Skills | `~/.hermes/skills/` (12 categories: apple, autonomous-ai-agents, creative, devops, email, media, note-taking, productivity, research, social-media, software-development, web) + work-specific ops skills |
| Plugins / hooks | `plugins/slack-open-chats` + `hooks/slack-open-chats` (only enabled plugin) |
| Cron | `cron/jobs.json`: 40 jobs (≈half enabled). Kinds: `cron`, `interval`, `once`. Delivery: `slack` (home channel), `telegram`, `origin`, `local`. Most attach a skill (ops-loop). Script jobs (`local`) run `~/.hermes/scripts/*.sh/.py/.mjs` without LLM |
| Scripts | `~/.hermes/scripts/`: paseo_watch/monitor/autoapprove (.mjs), gmail_autoarchive.py, slack_open_chats.py, slack_decisions.py, ngrok_webhooks.py, wh_{gitlab_pipeline,grafana_alert,sentry_issue,paseo_event}.py, notion_dispatch/watch.mjs, many ad-hoc monitor .sh |
| Webhooks | `webhook_subscriptions.json`: grafana-alerts, gitlab-pipelines, sentry-issues, paseo-events; exposed via ngrok (`com.hermes.ngrok-webhooks` runs `ngrok_webhooks.py`); platform `webhook` in config |
| Messaging platforms | Slack enabled (home channel, rich blocks, native task cards); Telegram configured but disabled; `slack-manifest.json` for app setup |
| TTS / STT | TTS `edge` (voice de-DE-FlorianMultilingualNeural, no key); STT enabled, provider auto (local whisper) |
| MCP servers (Hermes) | 16: `paseo` (stdio `~/.local/bin/paseo-mcp`), `gmail` (Google hosted MCP, OAuth), `slack` (Slack hosted MCP, OAuth), `grafana` (docker), `postgres-prod` (stdio, DSN), + ~11 work-specific HTTP MCPs (not shipped). OAuth tokens in `~/.hermes/mcp-tokens/` |
| launchd (`~/Library/LaunchAgents`) | `com.hermes.chrome-agent` (Chrome, `--user-data-dir=~/.chrome-agent --remote-debugging-port=9333 --remote-debugging-address=127.0.0.1`), `com.hermes.hermes-ui` (node `bin/hermes-ui.mjs serve`, repo `~/Documents/Development/Repositories/hermes-ui`), `com.hermes.ngrok-webhooks`, `com.hermes.paseo-watch`, `com.hermes.notion-dispatch` (+ notion-watch disabled). Gateway itself managed by Hermes |
| Paseo | `~/.paseo/config.json`: daemon `127.0.0.1:6767`, `mcp.injectIntoAgents: true`, `browserTools.enabled`, `appendSystemPrompt`; plugins `better-paseo`, `paseo-mcp`, `claude-accounts-usage` (local dev dir); `claude-accounts.json` (activeAccountId, identities, per-agent pinning = paseo-multi-account); 43 agent dirs, worktrees under `~/.paseo/worktrees`; `paseo` CLI not on PATH (app-bundled) |
| Claude Code | `~/.claude`: settings.json, CLAUDE.md, skills/ (browser-harness, frontend-design, gitlab-mr-review, impeccable, inbox-reply-drafts, refactoring-ui, ui-ux-pro-max, ios/android design, + company design/review skills), plugin `gitkraken-hooks`; `~/.claude.json` MCPs: plane, development, postgres-prod |
| CLIs on PATH | present: `gh`, `glab`, `browser-harness` (Hermes venv), `ngrok`, `claude`, `node` v24 (nvm), `uv`, `python3`, `docker`. Absent: himalaya, gws, memo, remindctl, imsg, xurl, codex, iroh, bun (Gmail/Workspace go via MCP instead) |
| Chrome CDP | Real Google Chrome listening on `localhost:9333` (dedicated profile `~/.chrome-agent`, logged in to sites manually) |
| iroh | No iroh binary/config found; remote access today = Hermes UI (+ Slack). Treat iroh as new work |

## 2. Capability matrix

| # | Capability | Mac implementation | Components / files | Auth needed | Mac-specific vs. portable |
|---|---|---|---|---|---|
| 1 | Orchestrator (Hermes) delegates coding to Paseo agents | Hermes calls `paseo` MCP → Paseo daemon spawns Claude Code agents in git worktrees | `paseo-mcp` (~/.local/bin), Paseo daemon :6767, `~/.paseo/config.json` | Claude login(s) for Paseo agents; git host creds | Portable. Paseo daemon headless on Linux needed (no desktop app) |
| 2 | Paseo events back to Hermes (bridge) | `paseo_watch.mjs` launchd + `wh_paseo_event.py` webhook + cron `ops-paseo`, `paseo-autoapprove` | scripts/, webhook `paseo-events`, launchd plist | none extra | Portable → replace with hermes-paseo-bridge plugin + systemd |
| 3 | Multi-Claude-account switching | `claude-accounts.json` (active account, per-agent pins, identities, retired config dirs) + `claude-accounts-usage` plugin | ~/.paseo | Several Claude subscriptions (OAuth via `claude` login per config dir) | Portable; OAuth login on headless VM needs device/URL flow in onboarding UI |
| 4 | Logged-in browser for agents | Real Chrome w/ dedicated profile, CDP 9333, launchd; `browser-harness` + Hermes `browser_exec`; Paseo `browserTools` | com.hermes.chrome-agent.plist, ~/.chrome-agent, browser-harness skill | Manual site logins inside that profile | Mac-specific launch (Chrome.app). Linux: chromium/chrome under Xvfb or headless=new + systemd; logins via remote view (noVNC/CDP screencast) during onboarding |
| 5 | Gmail | Google hosted Gmail MCP (read + drafts); cron `gmail-autoarchive` script | config mcp_servers.gmail, mcp-tokens | Google OAuth (browser consent) | Portable; OAuth redirect must work via config UI |
| 6 | Slack chat + reports | Hermes Slack platform (home channel), Slack hosted MCP, slack-open-chats plugin+hook | config platforms.slack, slack-manifest.json, plugins/ | Slack app bot/app tokens + MCP OAuth | Portable (Socket Mode → no inbound port) |
| 7 | Cron routines posting to Slack/Telegram | Hermes cron (40 jobs; cron/interval/once; skill-attached; deliver slack/telegram/origin/local) | cron/jobs.json, deliveries.db | via platform | Portable (inside Hermes gateway) |
| 8 | Script-only monitors (no LLM) | `local` cron jobs running shell/py/mjs | ~/.hermes/scripts | per-script CLIs | Portable; ship framework, not Max's scripts |
| 9 | Specialist bot profiles with SOUL | `profiles/{data,infra,support}` + `bots/soul-base.md` + `role-*.md` | profiles/, bots/ | inherits | Portable; ship base+role templates as defaults |
| 10 | Webhooks (Grafana, GitLab, Sentry, Paseo) | Hermes webhook platform + `wh_*.py` handlers; public URL via ngrok launchd | webhook_subscriptions.json, ngrok_webhooks.py | ngrok authtoken; per-source signing secrets | Portable; on VM prefer public IP/Caddy TLS or Cloudflare tunnel, ngrok optional |
| 11 | TTS / STT (voice notes) | Edge TTS (free), local whisper STT | config tts/stt | none | Portable (needs ffmpeg) |
| 12 | Remote/phone access | Hermes UI (node, launchd) + Slack/Telegram | hermes-ui repo, com.hermes.hermes-ui | UI auth | Portable server; remote exposure (iroh / tunnel) new for VM |
| 13 | Work/tool MCPs (observability, databases, payments, analytics…) | config mcp_servers (http, stdio, docker) | config.yaml, mcp-tokens | API keys/OAuth/DSN | Portable; not defaults — user-added via config UI catalog |
| 14 | Git hosting for agents | `gh`, `glab` CLIs | brew | gh/glab auth tokens | Portable (apt/binary) |
| 15 | Secrets vault | Hermes `vault/` (encrypted + key file), browser_vault tool | ~/.hermes/vault | local key | Portable |
| 16 | Kanban / task dispatch | Hermes kanban.db; notion_dispatch launchd | kanban.db, scripts | Notion token (optional) | Portable; Notion optional |
| 17 | Claude Code direct use | ~/.claude skills, plugins, `.claude.json` MCPs | ~/.claude | Claude login | Portable |
| 18 | Apple integrations (Notes, Reminders, iMessage, FindMy) | skills only; CLIs not installed | — | — | Mac-only → drop |
| 19 | Desktop computer-use | computer_use tool on macOS | — | macOS perms | Mac-only → drop / Xvfb later |

## 3. Default skills / MCPs worth shipping

**Role-agnostic (always)**: grounded-citations, document-to-action-items, meeting-action-items, email-inbox-triage, weekly-review-planning, product-price-monitor, competitor-news-monitor, humanizer, pdf, microsoft-office, maps, blocked-page-recovery, browser-harness/real-chrome-browser-harness (adapted to Linux), hermes-agent, youtube-content. MCPs: paseo-mcp; optional OAuth MCPs Gmail, Slack, Google Workspace.

**Dev**: github, (gitlab via glab), systematic-debugging, test-driven-development, requesting-code-review, simplify-code, spike, codebase-inspection, dogfood, plane-ticket-creator/user-story-manager, claude-code; Claude skills frontend-design, refactoring-ui, ui-ux-pro-max, mr-review. MCPs: Grafana, Postgres (read-only), Sentry (catalog, opt-in).

**Manager/ops**: an ops-loop template (TODOs, Gmail, Paseo status → Slack), morning-brief cron, support-analysis template, spend-analysis template, claude-design, baoyu-infographic, architecture-diagram. MCPs: Slack, Gmail, Notion/Plane, Metabase/PostHog (catalog).

Do NOT ship: company-specific skills/MCPs, Apple skills, disk-cleanup (Mac), Max's one-off cron jobs/scripts.

## 4. Must work on VM for v1

1. Hermes agent + gateway as systemd service, Anthropic/Claude auth via onboarding.
2. Paseo daemon headless + paseo-mcp + paseo-multi-account (≥2 Claude accounts, switching/pinning).
3. hermes-paseo-bridge plugin (replaces paseo_watch launchd + webhook): agent status/events into Hermes.
4. Hermes UI served and reachable remotely (phone), authenticated (tunnel/iroh or TLS reverse proxy).
5. Slack platform (Socket Mode) incl. home channel + cron delivery; Telegram optional.
6. Hermes cron (cron/interval/once, skill-attached, script-only jobs).
7. Persistent logged-in Chromium on CDP (Xvfb/headless) + browser-harness, with a way to log in once via the config UI.
8. Gmail/Slack OAuth MCPs connectable via config UI (redirect flow on headless host).
9. gh + glab installed and authable from onboarding; git identity.
10. Profiles with SOUL from base+role templates (default, dev, ops/support).
11. Webhook ingress (public URL) with per-source subscriptions.
12. TTS (edge) + STT (local whisper, ffmpeg).
13. Encrypted secrets vault; config UI never echoes secrets.
14. Default skill bundle (role-agnostic + dev + manager sets above).
