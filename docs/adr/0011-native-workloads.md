# 0011 – Native workloads, no containers in v1

- Status: accepted
- Date: 2026-11-22

## Decision

Hermes, Paseo and its agents, Hermes UI, KasmVNC and Chrome run natively under systemd as the
user `agentbox`; Caddy and the iroh gateway run as `agentbox-edge`. Docker is not required.
Agentbox owns every unit (`agentbox.target`), installs pinned release artifacts under
`/opt/agentbox/vendor/<component>/<version>`, keeps state in `/var/lib/agentbox` and the agents'
homes in `/home/agentbox`.

## Consequences

- Paseo and Hermes see a normal host filesystem, CDP stays on loopback, and upstream docs apply.
- **Known limitation (v1):** agents run under the same uid as the config server and the secret
  store's identity file. The box is single-tenant and the owner's agents are trusted with the
  owner's secrets. A separate agent uid is planned for v1.1.
- Every internal port binds 127.0.0.1; only Caddy's LAN listener faces the network.
