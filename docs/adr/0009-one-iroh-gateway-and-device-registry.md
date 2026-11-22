# 0009 – One iroh gateway and one device registry

- Status: accepted
- Date: 2026-11-22

## Context

Hermes UI already ships its own iroh gateway and device list. Agentbox needs remote access for
its own UI, Hermes UI and the streamed browser. Two gateways would mean two pairings, two
allow-lists and two revokes.

## Decision

- Agentbox runs the only `iroh-gateway` (irohkit/iroh-bridge 0.6.4) as user `agentbox-edge`, in
  front of Caddy's iroh listener (`127.0.0.1:8081`). Hermes UI runs with `HERMES_UI_REMOTE=off`.
- The device registry is the `devices` table in agentbox's SQLite. Agentbox renders the
  gateway's access file (`IROH_ALLOW_CLIENTS`, `IROH_ALLOW_PATHS`); a systemd path unit reloads
  the gateway (SIGHUP) when the file changes, so the service user never signals root-owned units.
- Pairing: a single-use 8-character code with a 10-minute window. While it is open the gateway
  admits any client, and agentbox only lets unknown endpoint ids reach the pairing endpoint.
  The phone uses the Hermes UI PWA (iroh-fetch, persistent identity); the laptop uses
  `agentbox connect`, a local proxy on iroh-fetch with a fixed key (the stock `iroh-proxy` CLI
  cannot take one).
- Caddy only trusts `X-Iroh-Remote-Id` on the iroh listener. Only the gateway's uid may connect
  to it (owner-match firewall rule), and it binds 127.0.0.1 only.

## Consequences

One QR, one allow-list, one revoke for every UI. The gateway is a small community project, so it
is pinned and checksum-verified, and its configuration is plain env, which keeps a fork cheap.
