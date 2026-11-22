# 03 — Onboarding UX & Skill/MCP/CLI Catalog

Status: draft v1 (2026-11-22). Goal metric: **time from URL open to first task sent (TTFT)**. Targets: under 3 min on the cloud trial, under 5 min self-hosted.

---

## 1. How others handle first run (what to copy)

| Product | First-run auth | What to copy |
|---|---|---|
| **Coder** (self-hosted) | First visitor to `/setup` creates the admin account. `coder login` uses a browser token paste flow. | A browser-first CLI login with a pasted session token. Avoid their open-`/setup` race: anyone who reaches the port first becomes admin. |
| **Coolify** | Same pattern: the first person to register becomes the root user. Marketplace images print the URL. | A tight install script that prints the URL at the end. The race is the anti-pattern again. |
| **Jupyter / code-server / Portainer** | A token printed to the console (`?token=…`), or a password stored in a config file. Portainer locks setup after 5 min. | **A one-time token printed to the console, plus a setup window that expires.** This is the Agentbox model. |
| **GitHub Codespaces / Gitpod (Ona)** | You are already authenticated through the SaaS identity, and git credentials are injected automatically. Prebuilds make startup fast. | Cloud trial: GitHub OAuth means a `gh` token is preconfigured with no extra step. Prebuilt images keep start time down. |
| **Railway / Vercel** | Magic link or OAuth at signup. Vercel's CLI uses `vercel login` with an email/device link. The "Import Git repo" step is the onboarding. | Treat picking a repo as the primary onboarding action. Don't show empty states. |
| **Cursor background agents / Devin** | You connect GitHub (App install), pick repos, and Devin's setup wizard lets an agent configure the env, secrets and "knowledge". | **The agent configures itself**: Devin-style "the AI sets up the machine" through the user's own model. Ask for secrets inline, only when needed. |
| **Replit Agent** | Signup, then a single prompt box. The task comes first and config comes later. | Put a "skip, send first task" exit on every screen. |
| **Zo Computer** | A personal cloud VM. Onboarding is a chat persona plus integrations connected through OAuth. | Choose a persona/role first, then suggest integrations. |
| **Daytona / E2B** | An API key from the dashboard, used as an env var (`DAYTONA_API_KEY`, `E2B_API_KEY`). Their sandboxes are developer infrastructure, not a UX to copy. | Secret storage handled as env vars. API keys are generated once and shown once. |
| **CLI device flows** | `gh auth login --web` (device code + github.com/login/device), `glab auth login` (OAuth web or PAT), `gcloud auth login --no-launch-browser`, `aws sso login --use-device-code`, `az login --use-device-code`. | **Run them headlessly in a PTY, parse the code and URL, and render them as a card with a Copy button and an "Open" button.** Poll until the CLI exits 0. |

**Auth decision for Agentbox**
- **Self-hosted:** the installer prints `https://<host>:<port>/setup?t=<otp>` plus a QR code and a 6-word code.
  - The OTP works once and expires after 30 min. After it expires, `agentbox otp` regenerates it.
  - The setup route returns 404 once an owner exists.
  - The first visit sets an owner passkey (WebAuthn), with a password as fallback.
  - TLS: use iroh or a Tailscale-style relay URL, or `sslip.io` + Let's Encrypt when a public IP exists. Otherwise fall back to a self-signed certificate plus a pinned fingerprint shown in the console.
- **Cloud:** GitHub/Google OAuth or a magic link at signup. The VM is pre-claimed, so no OTP is needed. The GitHub token is offered for `gh` with a single checkbox.

---

## 2. Catalog sources

| Source | Access | Scale / notes | Licence / ToS posture |
|---|---|---|---|
| **Official MCP Registry** `registry.modelcontextprotocol.io` | `GET /v0/servers` (cursor pagination, `updated_since`, `search`). Uses the `server.json` schema, which covers packages (npm/pypi/oci), remotes and env vars. | Canonical, namespaced (`io.github.x/y`), and built to be **mirrored by sub-registries**. | The registry code and data are open. **This is the primary source of truth.** |
| **PulseMCP** `api.pulsemcp.com/v0.1` | Implements the Generic Registry API plus enriched metadata (popularity, curation). | Curated, high quality. | Access goes through a partner agreement. Contact them. |
| **Smithery** `registry.smithery.ai/servers`, `api.smithery.ai` (OpenAPI) | Semantic search via `q`. Many entries are Smithery-hosted remotes. | Large. | API key for heavy use. Hosted remotes put Smithery in the data path; mark these as such. |
| **Glama** `glama.ai/api/mcp/v1/servers` | Public REST API. Includes security/licence/quality scores. | Around 125k servers (noisy). | Use as a secondary signal for licence and quality badges. |
| **mcp.so** | No stable public API, only scraping. | Large and noisy. | Skip, or use only for discovery. |
| **anthropics/skills** (GitHub) | A git repo of `SKILL.md` folders. | Small, high quality. | Mostly Apache-2.0. Some document skills are source-available. Check each skill. |
| **skills.sh / Vercel `skills` CLI** | `npx skills add owner/repo[/skill]`, plus the skills.sh leaderboard/index. | Growing ecosystem index with install counts. | Each skill keeps its repo's licence. |
| **Claude plugin marketplaces** | `.claude-plugin/marketplace.json` in git repos (`/plugin marketplace add owner/repo`). | Bundles skills, MCPs, commands and hooks. | Per repo. |
| **agentskills.io spec** | An open format: `SKILL.md` with `name`/`description` frontmatter plus optional `scripts/`, `references/` and `assets/`. | Supported by Claude, Codex, Hermes, Cursor and others. | **Adopt it as the native format.** |

---

## 3. Catalog architecture (recommendation)

```
 upstreams ──► ingest workers (hourly) ──► normalize ──► score ──► catalog DB ──► signed snapshot
 MCP Registry (primary, updated_since)      server.json /   stars, installs,   Postgres+pgvector  catalog-<date>.sqlite.zst
 PulseMCP/Glama/Smithery (enrich)           SKILL.md        licence, verified,  (cloud)            served via CDN
 GitHub skill repos, marketplaces           → CatalogItem   last-commit, tests                     ▲
                                                                                                   │ pulled by each box
                                         curated layer: role bundles (YAML, in git, PR-reviewed)   │ (offline-capable)
```

- **Mirror and index; don't proxy.** Each box pulls a signed SQLite snapshot of roughly 20–50 MB and runs autocomplete locally with FTS5 plus small embeddings, so search is instant and works offline. Self-hosters can point at the public snapshot or build their own with `agentbox catalog build`.
- **The unified `CatalogItem`** has these fields:
  - `id`, `kind` (skill | mcp | cli | bundle)
  - `source[]`, `install` (npm/pypi/oci/remote/git)
  - `env_schema` (secrets required, taken from `server.json`)
  - `auth` (none | api_key | oauth | device)
  - `licence`, `trust_tier`, `popularity`, `roles[]`, `tags[]`, `pinned_version`, `sha`
- **Trust tiers:**
  - T0: Agentbox-curated and tested in CI.
  - T1: official vendor (namespace verified in the MCP Registry).
  - T2: popular community entry with an OSI licence.
  - T3: everything else. These are hidden by default and need a "show unverified" toggle.
- **Install safety:**
  - Pin versions/SHAs.
  - Run stdio MCPs in per-server sandboxes with no host secrets beyond the declared env.
  - Show the env/permissions diff before install.
- **Role bundles** live in `catalog/bundles/*.yaml` in our repo and contain skills, MCPs, CLIs, SOUL snippets and suggested first tasks. Bundles are the main product surface. Search is the long tail.
- **Ranking for autocomplete:** text match × trust tier × role affinity × popularity, then deduped across sources by repo URL and package name.

### Starter role bundles

| Role | Skills | MCPs | CLIs | Suggested first task |
|---|---|---|---|---|
| Developer | code-review, TDD, systematic-debugging, github | GitHub, Context7/docs, Playwright, Postgres (opt.) | gh/glab, git, docker | "Review open PRs in <repo> and summarize risk" |
| Manager / PM | meeting-action-items, weekly-review, ticket-creator | Linear/Jira/Plane, Slack, Google Workspace, Notion | gws | "Summarize this week's tickets and draft standup" |
| Founder / Ops | email-triage, spend-analysis, competitor-monitor | Gmail, Calendar, Stripe (read), CRM | gws, stripe | "Triage my inbox and draft replies" |
| Data / Analyst | sql, notebooks, charts | Postgres, Metabase, BigQuery | gcloud, duckdb | "Answer: last month's top metrics" |
| DevOps / SRE | observability triage, k8s | Grafana, Sentry, AWS/GCP | kubectl, aws, gcloud, terraform | "Check alerts from the last 24h" |
| Support | support triage | Zendesk/Intercom, Slack | none | "Cluster this week's tickets by topic" |
| Designer / Marketer | humanizer, infographic, claude-design | Figma, Canva, analytics | none | "Draft a launch post" |

---

## 4. Onboarding flow (wireframe-level)

Rules for every screen:
- There is a progress rail on the left with 7 steps.
- Every step has an **"Skip → send first task"** link.
- Everything is editable later in Settings.
- The AI provider key is the only hard requirement.

**0. Console (self-hosted)**
```
✔ Agentbox installed.  Open:  https://box-7f3a.agentbox.dev/setup?t=river-lamp-oak-91
  [QR]   One-time code: river-lamp-oak-91 (expires 30 min)  ·  regenerate: agentbox otp
```

**1. Claim box** with a centered card that offers:
- an OTP field, prefilled from the URL
- "Create passkey" (primary) or "Use password"
- a name and email for recovery

The cloud version skips this screen.

**2. Connect your AI**
- Provider tiles: Anthropic, OpenAI, OpenRouter, Google and Local/Ollama. "Sign in with …" is used where OAuth or a subscription exists. Otherwise the user pastes a key.
- The key is validated live (green check + model list), and the user picks a default model.
- Cloud trial option: "Use included trial credits".

**3. Who are you?** shows a grid of role cards (Developer, Manager, Founder, Data, DevOps, Support, Custom).
- Multiple roles can be selected.
- There is an optional free-text field: "Describe your work in a sentence". The user's AI uses it to refine the bundle.

**4. Your toolkit** is the preselected bundle, split into three columns:
```
 Skills (8 ✓)          MCP servers (4 ✓)              Search library ▸ [ type "linear", "sentry"… ]
 [✓] code-review       [✓] GitHub     🔑 needs auth     autocomplete rows: icon · name · tier badge ·
 [✓] tdd               [✓] Playwright  ✓ ready          installs · licence · [+ Add]
```
- Items that need secrets show 🔑. Their auth is deferred to step 5, so this step only involves selecting items.
- "Why suggested?" tooltips show role and popularity.

**5. Connect accounts** lists only what the selected items require.
- **Device-flow card** (gh, glab, aws sso, gcloud, az):
  1. The backend spawns the CLI in a PTY and parses `XXXX-XXXX` and the URL.
  2. The UI shows a large code, [Copy], [Open github.com/login/device] and a spinner reading "waiting…".
  3. When the CLI exits 0, the card shows "✓ Signed in as @max".
  4. The token is stored in the box keychain and shared with the matching MCP (the GitHub MCP reuses the `gh` token).
- **OAuth-remote MCPs** (Linear, Notion, Slack remote servers) use a popup OAuth with a redirect back to the box.
- **API keys** use an inline masked input with a "Get key ↗" deep link and live validation.
- **SSH:** "Generate ed25519 key" shows the public key with [Copy] and [Add to GitHub automatically], which uses the `gh` token. A secondary option imports an existing key.

**6. Repos & workspace**
- When `gh`/`glab` is authenticated, the user picks repos from a searchable list sorted by recent pushes.
- The clone starts in the background with a progress chip, and the user can continue while it runs.
- Option: "Let the agent set up the dev env (install deps, run tests)". This queues as a background task.

**7. Your agents**
- The user's AI drafts 1–3 agent profiles from the role and repos, e.g. "Reviewer bot", "Inbox assistant".
- Each card has a name, purpose, enabled skills/MCPs and an editable pre-filled SOUL.md preview showing tone, user facts and guardrails.
- The user can [Accept all] or edit.

**8. Hand-off → Hermes UI**
- The first-task composer is prefilled with the bundle's suggested task, plus 3 alternative chips. A large [Send] button is the only primary action.
- A side panel offers "Pair your phone" (iroh QR) and is optional.
- TTFT is recorded.

Telemetry: track per-step time and drop-off with opt-in, anonymous events, and A/B test the step order. A likely win is moving step 5 to after the first task, triggered lazily: the agent asks for an auth card when it first needs GitHub.

---

## 5. "Agentbox skills" (per use case, shipped in the catalog, agentskills spec)

| Skill | Use case | Does |
|---|---|---|
| `agentbox-onboard` | First run / re-run | Interviews the user, picks a bundle, writes the config through the agentbox API. It is the conversational alternative to the wizard. |
| `agentbox-add-tool` | "Add Sentry" | Searches the local catalog, shows the trust tier and env diff, installs, and triggers the auth card. |
| `agentbox-auth-cli` | Any CLI login | Runs device flows headlessly, emits an auth card event and verifies with `gh auth status` and similar. |
| `agentbox-ssh` | Keys | Generates/rotates keys and registers them on GitHub/GitLab. |
| `agentbox-repo-setup` | New repo | Clones, detects the stack, installs deps, runs tests and writes AGENTS.md. |
| `agentbox-make-agent` | New bot | Drafts SOUL.md and a profile with a scoped toolset from a description. |
| `agentbox-doctor` | Troubleshooting | Health-checks MCPs, token expiry, disk and connectivity, then fixes or explains each problem. |
| `agentbox-catalog-curate` (internal) | Our team | Reviews new upstream entries, proposes bundle PRs and checks licences. |

---

## 6. Open questions / next steps
1. Negotiate PulseMCP/Smithery API terms. Build v1 on the MCP Registry + GitHub only.
2. Decide the TLS story for self-hosted: the iroh relay URL vs sslip.io.
3. Build the PTY device-flow parser for gh, glab, aws, gcloud and az first. This is the highest-UX-impact component.
4. Write the 7 bundle YAMLs, plus a CI job that installs each bundle on a fresh box nightly.

## Sources
- MCP Registry API: https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md , https://registry.modelcontextprotocol.io/v0/servers
- Smithery: https://registry.smithery.ai/servers , https://api.smithery.ai/openapi
- Glama: https://glama.ai/mcp/reference/list-mcp-servers
- PulseMCP: https://www.pulsemcp.com/api , https://www.pulsemcp.com/api/docs/v0.1
- Skills: https://agentskills.io/specification , https://vercel.com/docs/agent-resources/skills , https://github.com/anthropics/skills
- Coder: https://coder.com/docs/get-started/ · Coolify: https://docs.digitalocean.com/products/marketplace/catalog/coolify/
- Daytona: https://www.daytona.io/docs/en/
- gh headless device flow: https://github.com/Golopmoui3/gh-device-login
- The product notes for Codespaces, Gitpod/Ona, Railway, Vercel, Cursor, Devin, Replit, Zo and E2B come from general knowledge and were not re-verified this session.
