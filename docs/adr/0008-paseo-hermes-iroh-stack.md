# 0008 – Paseo, Hermes, Hermes UI and iroh replace CloudCLI, MetaMCP, Plane and Tailscale

- Status: accepted
- Date: 2026-11-22
- Supersedes: 0004, 0005, 0006, 0007

## Context

The first skeleton wired CloudCLI (Claude Code sessions in the browser), MetaMCP (MCP
aggregation), Plane (work items) and Tailscale (access). Using it showed the box should be
an agent you work *with*, not a set of tools you click through. That is exactly the setup that
already runs on the author's own machine: Hermes as the orchestrator, Paseo running the coding
agents, Hermes UI for daily work from any device, and a logged-in browser the agents share.

## Decision

Agentbox installs and wires, at pinned versions:

- **Hermes agent** (upstream NousResearch release tag, `v0.23.3`), run by an agentbox-owned
  systemd unit (`hermes gateway run --replace --external-supervisor`). Customisation lives in
  plugins, skills and config, never in a fork.
- **Paseo** (`@getpaseo/cli` 0.17.3) headless on loopback, relay and web UI off, with the
  **paseo-mcp** and **paseo-multi-account** plugins. Claude accounts are Paseo providers that
  extend `claude` with their own `CLAUDE_CONFIG_DIR`.
- **hermes-paseo-bridge**: a Hermes plugin that routes Paseo agent events back into the Hermes
  session that started the agent (replaces watcher scripts and an ngrok webhook).
- **Hermes UI** behind the box's edge at `/hermes/`, authenticated by agentbox (proxy auth).
- **One iroh gateway** (iroh-bridge `iroh-gateway` 0.6.4) as the only remote access path
  (see 0009). Tailscale is removed everywhere.
- A streamed **Chrome** (KasmVNC) with a persistent profile and CDP on loopback, shared by
  agents and the human.

CloudCLI, MetaMCP, Plane, Tailscale and the Docker workspace container are removed.

The agentbox binary keeps its role: Bun single binary with the embedded config UI, Hono + oRPC
contract, SQLite, age secret store, run events with redaction. Its UI is for setting up and
extending the box; Hermes UI is for working with it.

## Consequences

- Two UIs with one login: agentbox issues the session; Caddy's `forward_auth` protects
  `/hermes/` and `/browser/`.
- Every component is pinned in one place (`packages/providers/src/host/components.ts`) and
  installed from release artifacts with SHA-256 checks; nothing installs "latest" at runtime.
- Upstream Hermes moves fast; all Hermes calls go through one adapter (`apps/agentbox/src/hermes`).
- The fork `MaxGierlachowski/hermes-agent` is not used. Its `main` is 0 commits ahead of upstream;
  102 branches exist only in the fork, none with a commit by the fork owner (stale mirrors of
  deleted upstream branches). It can be archived.
