# 0004 – Access through Tailscale Serve on a Unix socket

- Status: accepted (to be verified on a VM in spike S1)
- Date: 2026-09-24

## Decision

Two listeners share one Hono app. `web.sock` (0600) is the only target of `tailscale serve`;
there `Tailscale-User-Login` is trusted and checked against an allow list. `127.0.0.1:7777`
serves the CLI (bearer token from `/run/agentbox/cli.token`) and SSH tunnels (one-time login
links); identity headers are ignored there. No 0.0.0.0 bind.

## Consequences

Local processes cannot forge an identity by calling the TCP listener. Unix socket targets need
Tailscale 1.94 or later (documented in the CLI help, not the KB): verify in spike S1.
