# agentbox

Turns an empty Ubuntu VM into a ready-to-use workspace for coding agents (Claude Code, Codex,
Gemini) from one declarative spec. Comes with CloudCLI (Claude Code sessions in the browser),
Plane (work items) and MetaMCP (MCP servers), wired together, plus an automation that hands
Plane items labelled `claude` to Claude Code. Single binary, host mode, reachable only through
your tailnet.

Status: **Phase 0 (walking skeleton)**. See [docs/implementation-plan.md](docs/implementation-plan.md).

## Development

Requires Bun 1.4.2 or later.

```sh
bun install
bun run dev
```

Open http://localhost:3100. In development you are signed in as `dev@localhost`.

## Build

```sh
bun run --cwd apps/agentbox compile --target linux-x64 --target linux-arm64
```

The binaries in `apps/agentbox/dist/` embed the UI. On a server:

```sh
AGENTBOX_ALLOWED_USERS=you@example.com agentbox up
sudo tailscale serve --bg --https=8443 unix:/run/agentbox/web.sock   # agentbox UI, tailnet only
```

Without Tailscale, tunnel in with `ssh -L 7777:127.0.0.1:7777 <vm>` and run `agentbox login-link`.
