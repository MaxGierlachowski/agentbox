# 0007 – CloudCLI, MetaMCP and Plane instead of an agent platform

- Status: superseded by 0008 (supersedes 0006)
- Date: 2026-10-10

## Context

Paperclip was evaluated and is too heavy on context for our agents. We want plain Claude Code
sessions with a good web UI, one place to manage MCP servers, a real PM tool, and our own small
automation between them.

## Decision

- **CloudCLI** (`@cloudcli-ai/cloudcli`) runs inside the workspace container next to Claude Code,
  toolchains and the browser. agentbox registers its single user (which closes registration) and
  creates an API key for automation.
- **MetaMCP** manages MCP servers. agentbox creates the admin, closes sign-up, creates namespace
  `agentbox` and endpoint `claude` with API-key auth, pre-installs the Plane MCP, and writes one
  HTTP MCP entry with the bearer token into Claude Code's `~/.claude.json`. A small Caddy
  (`mcp-gateway`) hides `/.well-known/oauth-*` because of MetaMCP issue #277.
- **Plane CE** from the pinned release compose; bootstrap through a Django shell script (admin,
  workspace, bot user, API token), then REST v1 (project, label `claude`, state "In Review").
- **Automation** inside the agentbox daemon: poll Plane for open items labelled `claude`, move to
  In Progress, start a CloudCLI session via `POST /api/agent`, comment the session link, comment
  the result, move to In Review.
- Everything is tailnet-only (`tailscale serve`, ports 443/8443/8444/8445). No Funnel.
- One admin identity for all tools, entered in the agentbox UI; password only in the secret store.

## Consequences

- Three fast-moving third-party apps with their own auth: pin versions, nightly contract tests,
  registration closed before `tailscale serve`, no Docker socket in any container.
- MetaMCP has no RBAC; every logged-in user can run stdio processes in its container.
- Plane needs 4–8 GB RAM on its own; the VM minimum rises to 8 GB (16 GB recommended).
- Plane CE cannot filter by label server-side and blocks webhooks to private/Tailscale targets, so
  the automation polls.
