# agentbox

Your own agent box on one VM. One command installs and wires an orchestrating agent, coding
agents, a logged-in browser they share, and a UI you can reach from your laptop and phone over
an end-to-end encrypted peer-to-peer connection. No open ports, no accounts with us.

```sh
curl -fsSL https://maxgierlachowski.github.io/agentbox/install.sh | sudo AGENTBOX_UP=1 sh
```

Then open the URL `agentbox up` prints (`https://<lan-ip>:8443/setup/#otp=…`), enter the
one-time code, and the onboarding takes you from "connect your AI" to your first task.

Status: **v0.1 release candidate**. Tested target: Ubuntu 24.04 (x64; arm64 builds too).

## What gets installed

| Piece | What it does |
|---|---|
| [Hermes agent](https://github.com/NousResearch/hermes-agent) | The orchestrator you talk to: memory, skills, crons, Slack, voice, profiles |
| [Hermes UI](https://github.com/MaxGierlachowski/hermes-ui) | Board and inbox for Hermes sessions, on any device |
| [Paseo](https://paseo.sh) | Runs Claude Code / Codex agents in git worktrees, headless |
| [paseo-mcp](https://github.com/MaxGierlachowski/paseo-mcp) | Lets Hermes start, steer and watch Paseo agents |
| [paseo-multi-account](https://github.com/MaxGierlachowski/paseo-multi-account) | Several Claude subscriptions behind one provider, switch and pin per agent |
| [hermes-paseo-bridge](https://github.com/MaxGierlachowski/hermes-paseo-bridge) | Paseo agent events continue the Hermes session that started the agent |
| [iroh-gateway](https://github.com/irohkit/iroh-bridge) | The only remote access: QUIC, end-to-end encrypted, device allow-list |
| [KasmVNC](https://github.com/kasmtech/KasmVNC) + Chrome | One persistent browser; you log in to sites, agents use the sessions |
| [Caddy](https://caddyserver.com) | Single origin on the box: config UI, `/hermes/`, `/browser/` behind one login |

How they fit together: [docs/plan/00-master-plan.md §3](docs/plan/00-master-plan.md).
Decisions: [docs/adr/](docs/adr/).

## Everyday commands

```sh
sudo agentbox up            # install or repair (idempotent)
sudo agentbox otp           # new one-time code to claim the box
sudo agentbox reset-owner   # forgot the password
agentbox doctor             # health of every service and the network exposure
agentbox connect <id>       # on your laptop: the box on http://localhost:8080 over iroh
```

## Security model (short)

Single owner per box. Every internal service listens on 127.0.0.1; only the LAN listener
(`:8443`, self-signed, fingerprint printed) faces the network, and only on private networks.
Remote access is iroh with an allow-list of paired devices. Secrets are encrypted at rest (age)
and never shown again after you enter them. Known v1 limitation: your agents run under the same
user as the config service (see [ADR 0011](docs/adr/0011-native-workloads.md)).

## Development

Requires Bun 1.4.2 or later.

```sh
bun install
bun run dev                 # API on :7777 + next dev on :3100
bunx turbo typecheck lint test
bun run --cwd apps/agentbox compile --target linux-x64 --target linux-arm64
```
