Release candidate 3 of agentbox v1: your own agent box on one Ubuntu 24.04 VM.

Changes since rc.2:
- The companions now ship as their own releases (hermes-ui v0.3.0, paseo-multi-account v1.1.0,
  hermes-paseo-bridge v0.1.0, paseo-mcp v0.5.0-rc.1); agentbox pins them by URL and sha256.
- The streamed browser shows the whole box desktop: a fixed 1600×900 screen that the config UI
  scales to its panel, with Chrome always maximized (rc.2 showed a cropped, shrinking desktop).
- `agentbox up` restarts a component's service when its install changed (upgrades from rc.2).
- The install step says which items still wait for a sign-in; paseo and git count as installed.

```sh
curl -fsSL https://maxgierlachowski.github.io/agentbox/install.sh | sudo AGENTBOX_UP=1 sh
```

(The same installer is attached to this release as `install.sh`.)

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
- `SHA256SUMS`

**Known limitations:** agents run under the same user as the config service (single-owner box);
one active Claude account for all agents (no per-agent pinning yet); phone pairing over iroh needs
the Hermes UI PWA with `base` support on its Pages site; release binaries are not signed yet (SHA-256
over HTTPS only). Plan, decisions and spike reports: `docs/plan/`, `docs/adr/`, `docs/spikes/`.
