First release candidate of agentbox v1: your own agent box on one Ubuntu 24.04 VM.

```sh
curl -fsSL https://github.com/MaxGierlachowski/agentbox/releases/download/v0.1.0-rc.1/install.sh | sudo AGENTBOX_UP=1 sh
```

Then open the printed `https://<lan-ip>:8443/setup/#otp=…` link, enter the one-time code, and
follow the onboarding.

**What gets installed (pinned, checksum-verified):** Hermes agent v0.23.3, Hermes UI 0.3.0,
Paseo 0.17.3 with paseo-mcp 0.5.0-rc.1 and paseo-multi-account 1.1.0, hermes-paseo-bridge 0.1.0,
Claude Code 2.1.330, gh 2.105.0, glab 1.131.0, Google Chrome stable in KasmVNC 1.5.2, Caddy 2.11.9,
iroh-gateway 0.6.4, Node.js 24.22.3.

**Assets**
- `install.sh`: the installer (Ubuntu 24.04, x86_64 or arm64)
- `agentbox-linux-x64`, `agentbox-linux-arm64`: the box binary
- `agentbox-darwin-arm64`, `agentbox-darwin-x64`: `agentbox connect` for your laptop
- `hermes-ui-*.tgz`, `paseo-multi-account-*.tgz`, `hermes-paseo-bridge-*.tar.gz`, `paseo-mcp-*.tgz`: components the box installs
- `SHA256SUMS`

**Known limitations:** agents run under the same user as the config service (single-owner box);
one active Claude account for all agents (no per-agent pinning yet); phone pairing over iroh needs
the Hermes UI PWA with `base` support on its Pages site; release binaries are not signed yet (SHA-256
over HTTPS only). Plan, decisions and spike reports: `docs/plan/`, `docs/adr/`, `docs/spikes/`.
