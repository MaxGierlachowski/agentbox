# VM-TEST — Agentbox v0.1.0-rc.3 on a clean Proxmox VM

Goal: from an empty Ubuntu 24.04 VM to a first task that a Paseo agent executes, with one install
command, the onboarding, and your phone/laptop paired over iroh. About 30–45 minutes, most of it
logins only you can do.

Release: https://github.com/MaxGierlachowski/agentbox/releases/tag/v0.1.0-rc.3 (pre-release). Installer: https://maxgierlachowski.github.io/agentbox/install.sh

---

## 0. Before you start

- All five repos are merged; Pages serves the installer and the Hermes UI PWA (with `base`, needed
  for phone pairing over iroh). Every companion has its own pre-release; agentbox pins them by sha256.
- Have ready: a Claude subscription (or an Anthropic API key), a GitHub account, a phone, a laptop.
- Want to see it first? `agentbox-plan/video/agentbox-setup.mp4` shows the whole run.

## 1. Create the VM (Proxmox)

1. Download the **Ubuntu Server 24.04 LTS** ISO (`ubuntu-24.04.x-live-server-amd64.iso`) into the
   Proxmox ISO storage (or use the 24.04 cloud image with cloud-init, same result).
2. Create VM: **4 vCPU, 8 GB RAM, 40 GB disk**, CPU type `host`, network `vmbr0` (your LAN bridge),
   VirtIO NIC. No GPU needed.
3. Install Ubuntu: minimal or standard, **enable OpenSSH server**, create your user (e.g. `max`).
   Note the IP shown at the end (or `ip -4 addr` on the console).
4. `ssh max@<vm-ip>` from your laptop. Optional but recommended: take a Proxmox **snapshot** named
   `clean` now, so you can repeat the test from scratch.

## 2. Install (one command)

```sh
curl -fsSL https://maxgierlachowski.github.io/agentbox/install.sh | sudo AGENTBOX_UP=1 sh
```

What you should see (≈5–8 minutes on a fresh VM; Hermes is the longest step):

```
agentbox 0.1.0-rc.3 (linux-x64)
  downloading …/agentbox-linux-x64
  sha256 ok
  installed /usr/local/bin/agentbox

agentbox up 0.1.0-rc.3 · Ubuntu 24.04.x LTS · amd64

  ✔ Base packages, users, directories            done (…)
  ✔ agentbox 0.1.0-rc.3                          done
  ✔ Node.js 24.22.3                              done
  ✔ Paseo 0.17.3                                 done
  ✔ Claude Code 2.1.330                          done
  ✔ gh 2.105.0 / glab 1.131.0                    done
  ✔ Caddy 2.11.9 / iroh gateway 0.6.4            done
  ✔ KasmVNC 1.5.2 (browser stream)               done
  ✔ Google Chrome                                done
  ✔ Hermes v0.23.3 (takes a few minutes)         done
  ✔ paseo-mcp / hermes-ui / paseo-multi-account / hermes-paseo-bridge
  ✔ Edge config (LAN https://<vm-ip>:8443)       done
  ✔ Services, Firewall and edge, Paseo daemon and plugins, Hermes, Browser, agentbox …

✔ Agentbox is running (9/9 services healthy)
  Open:  https://<vm-ip>:8443/setup/#otp=word-word-word-word-word-word
         (self-signed certificate, SHA-256 AB:CD:…)
  or:    ssh -L 8080:127.0.0.1:8080 max@<vm-ip>  →  http://localhost:8080/setup/#otp=…
  One-time code: word word word word word word   (valid 60 min · new code: sudo agentbox otp)
```

Check right away (optional): `sudo agentbox up` again → every line `noop`. `agentbox doctor` → all ✔.

## 3. Claim the box

1. Open the printed `https://<vm-ip>:8443/setup/#otp=…` URL on your laptop.
2. The browser warns about the certificate. Compare the SHA-256 fingerprint in the certificate
   details with the one printed on the console, then continue (Chrome: "Advanced → Proceed").
3. Screen **Claim**: the code is prefilled. Enter name, e-mail, a password (12+ characters).
   → you are signed in; `/setup` now returns 404 forever (new code: `sudo agentbox otp` only works
   before the claim; forgot the password: `sudo agentbox reset-owner`).

## 4. Onboarding (each step can be skipped and re-run later from Settings)

| Step | What you do | What you should see |
|---|---|---|
| **Connect AI** | "Add Claude account" → open the link → sign in on claude.ai → copy the `code#state` shown → paste. Repeat for a 2nd account (multi-account). Then "Hermes model": either "Use my Claude subscription" (one more sign-in + paste) or an Anthropic API key. "Test" | Accounts turn **Ready**; Hermes test answers "READY" |
| **Who are you** | Pick roles (e.g. Developer + Manager), one line about your work, timezone, language | — |
| **Your toolkit** | Review the preselected skills/MCPs/CLIs, search the library (e.g. "linear", "postgres"), add/remove | gh/glab start installing in the background |
| **Your SOUL** | Read the composed SOUL; edit "About you" | Box facts block is read-only |
| **Connect accounts** | GitHub card → copy the code → open github.com/login/device → approve. GitLab likewise if selected. OAuth MCPs (Gmail, Slack…) → "Connect" → finish the consent **in the box browser panel** | Cards turn green "signed in as @you" |
| **SSH & repos** | Generate key → "Add to GitHub"; pick 1–2 repos → Clone | Key appears in GitHub → Settings → SSH keys; clone log runs |
| **Your agents** | AI drafts 1–3 profiles (e.g. Reviewer, Inbox) → accept/edit | Profiles created (`hermes profile list` on the VM) |
| **Browser logins** | The box's Chrome streams in the page. Turn on "Take control", log in to sites your agents should use (GitHub, Google…), then "Done" | Logins persist (Chrome profile on the box) |
| **Install & hand-off** | Apply → watch the run log → **Open Hermes UI** | Hermes UI opens at `/hermes/` with the first task prefilled |

## 5. First task (the definition of done)

In Hermes UI, send the prefilled task (e.g. "Clone one of my repos and have a Paseo agent
summarize its architecture and open TODOs").

Expected: Hermes plans, calls the `paseo` MCP to start a Claude Code agent in
`~/work/github.com/<you>/<repo>`; the agent shows up on the board; when its turn ends, a
`[paseo]` follow-up appears **in the same Hermes session** (hermes-paseo-bridge) and Hermes reports.

On the VM you can watch: `sudo -iu agentbox paseo ls` (agents), `journalctl -u agentbox-hermes -f`.

## 6. Multi-account

Config UI → Settings → AI accounts → "Make default" on the 2nd account. New Paseo agents use it
(`sudo -iu agentbox paseo-claude-accounts list`). Per-agent pinning is not in v1 (STATUS.md, decision 5).

## 7. Pair your laptop (iroh)

1. Download `agentbox-darwin-arm64` (or `-darwin-x64`, `-linux-x64`) from the release, `chmod +x`, move to `/usr/local/bin/agentbox`.
   macOS: `xattr -d com.apple.quarantine /usr/local/bin/agentbox` (unsigned binary).
2. Config UI → Devices → **Pair a device** → copy the `agentbox connect <id> --code <code>` command.
3. Run it on the laptop. Expected: `Pairing … paired`, then `✔ Your box is on http://localhost:8080`
   (`path: direct` on the same LAN, `relay` from elsewhere).
4. Open http://localhost:8080 → config UI (signed in as your device), `/hermes/`, Browser — all over iroh.
5. Next time just run `agentbox connect`.
6. Revoke in Devices → the laptop loses access immediately.

## 8. Pair your phone

a) **LAN (works now):** open `https://<vm-ip>:8443/hermes/` on the phone, accept the certificate, sign in.
b) **iroh:** Devices → Pair a device → scan the QR with the phone →
   the Hermes UI PWA opens and pairs → "Add to Home Screen". Works from anywhere (mobile data).
   Send a task from the phone.

## 9. Automatic checks (optional)

From your laptop (needs ssh + passwordless sudo on the VM, `jq`, the agentbox binary from step 7):

```sh
git clone -b v1 https://github.com/MaxGierlachowski/agentbox && cd agentbox
VM=max@<vm-ip> ./e2e/vm/acceptance.sh health claim browser idempotent iroh reboot
```
(Run `install` too on a fresh snapshot; skip `claim` if you already claimed in the UI.)

## 10. Troubleshooting

| Symptom | Check / fix |
|---|---|
| Install stops at a step | Re-run `sudo agentbox up` (it resumes; `AGENTBOX_VERBOSE=1` shows script output). Logs: `journalctl -u 'agentbox-*' -n 200` |
| "not all services healthy" | `agentbox doctor`; `systemctl status agentbox-<name>` |
| OTP expired / lost | `sudo agentbox otp` (prints a new link); `/var/lib/agentbox/first-run.txt` has the last one |
| Forgot password | `sudo agentbox reset-owner` → open the printed `/reset/#otp=…` link |
| Browser shows "connection refused" on :8443 | VM has a public IP → loopback mode; use the printed SSH tunnel, or `sudo agentbox up --listen lan` |
| LAN IP changed (DHCP) | `sudo agentbox up` (new certificate, new fingerprint) — or give the VM a DHCP reservation |
| Hermes test fails | Settings → AI: model and login; on the VM `sudo -iu agentbox hermes chat -q hi` |
| Claude login "code wasn't accepted" | Copy the full `code#state`, within a few minutes; start the login again |
| gh card never turns green | Approve on github.com/login/device within 15 min; retry the card |
| Box browser blank | `systemctl restart agentbox-kasmvnc` (Chrome follows); Chrome crashing under AppArmor → `journalctl -u agentbox-chrome` |
| `agentbox connect` hangs | Box offline from the relay? `curl -s 127.0.0.1:8090/status` on the VM shows `online`; corporate networks may block UDP (relay still works over HTTPS) |
| Phone pairing link opens an old app | Reload the PWA (it caches); Pages serves Hermes UI 0.3.0 |

## 11. What was verified before you got this (and what only you can verify)

Verified automatically before you got this (v0.1.0-rc.3; see STATUS.md):
- The exact one-liner from the GitHub release on a clean Ubuntu 24.04 arm64 systemd container:
  9/9 healthy, then the real config UI driven end to end (`e2e/vm/ui-smoke.ts`) up to Hermes UI with
  the first task, and a laptop paired over iroh with the released macOS binary.

Earlier, in more detail:
- Clean Ubuntu 24.04 **arm64** systemd container: `install.sh` → `agentbox up` (9/9 healthy), second run all `noop`, LAN claim with OTP, `/setup` gone, login redirect, Hermes UI and browser stream behind forward_auth, Hermes UI connected to the Hermes gateway, Hermes sees the paseo MCP tools, Paseo plugins running, bridge receiver on loopback, toolkit install (skills, MCP, CLI via sudo helper), SSH key, SOUL, template profiles, hand-off redirect, login flows show URL/code (claude, Hermes, gh, glab — not completed), `agentbox connect` pairing over iroh (direct path), WebSocket (KasmVNC) over iroh, CSRF guard, revoke.
- **x64** on GitHub's Ubuntu 24.04 VM: same install/up/health/claim/idempotency/doctor (workflow `E2E install (x64)`).
- Each companion repo's own CI (Linux x64 + arm64) and the spikes S1–S9.

Only you can verify (needs your accounts/devices):
- Claude login completion (2 accounts), Hermes answering with your model, a real Paseo agent run and the bridge follow-up in the same session.
- gh/glab device flows, SSH key upload, cloning private repos.
- Site logins in the streamed Chrome (incl. Google from a datacenter/LAN IP), Gmail/Slack MCP OAuth.
- Phone pairing over iroh, latency on mobile data.
- Proxmox-specific bits: real VM firewall/AppArmor, DHCP, reboot behaviour (`acceptance.sh reboot`).
