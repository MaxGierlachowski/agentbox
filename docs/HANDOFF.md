# Handoff: how to continue Agentbox

Everything needed to pick up Agentbox on any machine, by a human or by an AI agent. Read this first,
then `AGENTS.md` (code rules) and the pinned [Roadmap issue #28](https://github.com/MaxGierlachowski/agentbox/issues/28).

Last updated: 2026-11-23 · Current release: **v0.1.0-rc.3** (pre-release)

---

## 1. Product goal (owner's brief)

- A user only needs a VM. Either they set it up themselves (`curl … | sudo sh`, then `agentbox up`)
  or they use the hosted cloud version (later: signup, 7-day free trial, we start the VM).
- They open one URL, enter a one-time code from the console, and go through a short guided
  onboarding. They should never notice the individual open-source projects underneath.
- **Two separate UIs:**
  1. **Agentbox UI** (served by the agentbox binary): only setup, extension and overview of the box:
     what is installed, which capabilities it has, what it can access.
  2. **Hermes UI**: the daily workspace once the box is set up. Hosted and connected automatically;
     phone and laptop pair over iroh.
- **Stack, installed and wired automatically:** Paseo (+ paseo-multi-account, paseo-mcp),
  Hermes agent (+ hermes-paseo-bridge plugin), Hermes UI, a streamed Chrome for site logins.
- **Removed for good:** Plane, MetaMCP, CloudCLI, Tailscale. **Remote access only via iroh.**
- **Onboarding with the least possible manual work**, aiming at "first task sent" as fast as possible:
  connect AI → pick a role (developer, manager, …) → skills and MCPs preconfigured for that role,
  extendable through autocomplete over a large library (no repo browsing, no uploads) → pre-filled
  Hermes SOUL files → CLIs (gh, glab, …) with guided auth → SSH keys and repos → AI-drafted agent
  profiles → site logins in the streamed Chrome → hand-off into Hermes UI with the first task prefilled.
- **Benchmark for v1:** a power user's local agent setup (orchestrator agent delegating to Paseo coding
  agents, logged-in Chrome for agents, mail via MCP, cron routines, specialist bot profiles,
  multi-account switching, phone access) must work on a clean Ubuntu 24.04 VM after the CLI and
  the onboarding.
- **Later:** organisations. A manager builds e.g. a finance profile (skills, MCPs, knowledge) and
  shares it; boxes of the org get it automatically.
- Landing page / GitHub Pages names every involved open-source project and how they fit together.

## 2. Repositories

| Repo | Role | Release |
|---|---|---|
| [agentbox](https://github.com/MaxGierlachowski/agentbox) | Installer, config UI, onboarding, catalog, iroh gateway, `agentbox connect` | v0.1.0-rc.3 |
| [hermes-ui](https://github.com/MaxGierlachowski/hermes-ui) | Workspace UI (Kanban, chat, PWA, iroh pairing) | v0.3.x |
| [paseo-mcp](https://github.com/MaxGierlachowski/paseo-mcp) | MCP server: orchestrator agents start/steer Paseo agents | v0.5.0-rc.1 |
| [paseo-multi-account](https://github.com/MaxGierlachowski/paseo-multi-account) | Paseo plugin: several Claude accounts | v1.1.0 |
| [hermes-paseo-bridge](https://github.com/MaxGierlachowski/hermes-paseo-bridge) | Hermes plugin: Paseo agent events continue the Hermes session that started them | v0.1.0 |
| [hermes-agent](https://github.com/MaxGierlachowski/hermes-agent) | Fork, reference only. Agentbox installs **pinned upstream** NousResearch Hermes (v0.23.3) | – |

## 3. Where the knowledge lives

- `docs/plan/00-master-plan.md`: decision-complete v1 plan (architecture, conflicts C1–C19,
  work packages, spikes, risks, out of scope §18, cloud design hooks §19).
- `docs/plan/01–05`: research behind the plan (benchmark, repo audit, UX + catalog research,
  browser + runtime, fact-check review). `docs/plan/v1-interfaces.md`: contracts between repos and pins.
- `docs/adr/0008–0012`: the v1 decisions (stack, one iroh gateway + device registry, OTP/LAN first
  access, native workloads without containers, catalog sources). 0004–0007 are superseded.
- `docs/spikes/`: results of spikes S1–S9 (all passed; S7 phone stream deferred).
- `docs/vm-test.md`: step-by-step acceptance test on a clean Proxmox VM.
- `docs/release-notes.md`, GitHub Releases: what each rc contains.
- `e2e/video/`: re-record the setup video for any release (`record.sh`).
- GitHub issues + milestones: everything still to do (see §5).

## 4. State (2026-11-23)

**Done and verified**
- All v1 work merged to `main` in all five repos; Pages live with the landing page and the installer:
  `curl -fsSL https://maxgierlachowski.github.io/agentbox/install.sh | sudo AGENTBOX_UP=1 sh`
- Clean Ubuntu 24.04 (arm64 systemd container and x64 GitHub Actions VMs): install → 9/9 services
  healthy in ~3 min, idempotent re-run, OTP claim, all 9 onboarding steps through the real UI, real
  catalog + live MCP Registry search, Claude sign-in link and GitHub device code shown, streamed
  Chrome, toolkit install, hand-off into Hermes UI with the first task prefilled, laptop paired over iroh.
- Setup video (3:13) and a short cut (1:16) recorded from the public one-liner.
- Hermes UI plays video attachments (`MEDIA:` mp4/webm/mov with range requests) since 0.3.1.

**Not yet verified (needs real accounts)**
- Completing real Claude / GitHub / GitLab / Google logins, a Paseo agent run on a real account,
  bridge follow-up into the Hermes session, phone pairing. → issue #4.

**Known limitations in v1**
- Agents run under the same uid as the config server and secrets (#9).
- One active Claude account for all agents (#10).
- Releases are checksum-verified only, no signature yet (#5).

**Decisions taken by default (change if you disagree)**
1. No own domain yet: installer and landing on GitHub Pages; base URL is one constant
   (`AGENTBOX_BASE_URL` in `install.sh` and `apps/agentbox/src/release.ts`).
2. paseo-mcp ships as GitHub Release tarballs (the npm name `paseo-mcp` belongs to someone else).
3. Paseo pinned to 0.17.x; Hermes to upstream v0.23.3 (never `canary`/`rc` tags).
4. Hermes with a Claude subscription needs its own OAuth paste-code step; an Anthropic API key is the
   alternative (#8).

## 5. Next steps

Order: **v0.1.0** (VM test → signing → launch) → **Cloud plan** in parallel with **v0.2 hardening** →
**Org & profiles** after a working cloud MVP. All items are issues in these milestones:

- **v0.1.0:** #4 real-account VM test · #5 minisign · #6 promote releases · #7 soft launch (video,
  posts, domain) · #8 Hermes model auth default
- **v0.2 (v1.1):** #9–#19 (separate agent uid, per-agent account, webhooks, phone browser stream,
  repo-setup agent, apply log on reload, uninstall, auto-update with rollback, backups, arm64 gate,
  catalog pipeline)
- **Cloud (SaaS):** #20 write the cloud plan first, then #21–#24 (signup/billing/trial, provisioning
  with pre-claimed boxes, edge with per-box subdomains, own iroh relays)
- **Org & profiles:** #25–#27

## 6. How the work was done (repeat this for big steps, e.g. the cloud plan #20)

1. **Research fan-out:** several agents in parallel, one file each (benchmark of the target setup,
   repo audit, UX/market research, runtime/infra design). Give every agent the fixed decisions above.
2. **Synthesis:** one agent writes a single decision-complete plan with a conflict table, work
   packages (repo, files, acceptance criteria, test commands), spikes with decided fallbacks, an
   end-to-end test script and an explicit out-of-scope list.
3. **Fact-check review:** a separate agent checks every version, flag and config key against real
   `--help` output, source code and releases, and fixes the plan in place. (The first draft of the v1
   plan had ~30 wrong facts; this step is not optional.)
4. **Implementation:** one lead coding agent works through the packages in dependency order with
   sub-agents, keeps a `STATUS.md` (done / in progress / blocked / decisions with a default), and
   writes a `HANDOFF.md` when it runs out of session.
5. Branch per repo, PR, merge when CI is green, pre-release tags; the release workflow builds and
   publishes on tag push.

## 7. Local test setup notes

- On an Apple Silicon Mac, systemd units do not start inside emulated amd64 containers. Use a native
  arm64 Ubuntu 24.04 systemd container for the full flow locally and the GitHub workflow
  "E2E install (x64)" for x64 (`gh workflow run e2e-install.yml --ref main`).
- Container recipe, local release build and the real-UI smoke test: see `e2e/vm/` and
  `e2e/video/README.md`.
- Build/test: `bun install && bunx turbo typecheck lint test`.

## 8. Rules for anyone (or any agent) continuing

- Keep all repos generic: no personal or company names, accounts, paths or systems in code, docs or defaults.
- Knowledge goes into the repos (docs, ADRs, issues), not only into chat transcripts.
- Never commit secrets; never force-push `main`; no history rewriting.
- Hermes customisations live in plugins, skills and config, never in a Hermes fork.
- Reuse existing components before adding daemons (one iroh gateway, one device list).
