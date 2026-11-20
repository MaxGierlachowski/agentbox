# 0002 – oRPC with a shared contract

- Status: accepted
- Date: 2026-09-24

## Context

The UI and the CLI need a typed API, plus live run logs that survive reconnects.

## Decision

Contract-first oRPC 1.x in `packages/contract`. Run logs are event iterators; each event carries
its sequence number as SSE id and the server replays from SQLite on `lastEventId`.

## Consequences

- The web bundle imports only the contract, never server code.
- oRPC v2 changes the wire format; upgrading is a deliberate, contained work package.
