# 0010 – First access: one-time code, LAN HTTPS or SSH tunnel

- Status: accepted
- Date: 2026-11-22

## Decision

- `agentbox up` detects the network. With only private (RFC 1918/ULA) addresses it enables a LAN
  listener `https://<lan-ip>:8443` with a self-signed certificate whose SHA-256 fingerprint is
  printed. With a public address it binds loopback only and prints the SSH tunnel command.
  `--listen lan|local` overrides the detection.
- The console shows a six-word one-time code (EFF large wordlist, ~77 bits), valid 60 minutes,
  single use, 5 attempts per minute per client. It travels in the URL fragment, so it never
  reaches logs. `sudo agentbox otp` issues a new one; `/setup` returns 404 after the claim.
- Claiming creates the single owner with a password (argon2id). Passkeys are deferred: WebAuthn
  fails on a self-signed LAN certificate. `sudo agentbox reset-owner` issues a code that only
  allows setting a new password.

## Consequences

The main target (a VM on a home or office LAN, e.g. Proxmox) needs no manual network setup and
exposes exactly one port. Users see a certificate warning once and can compare the fingerprint.
