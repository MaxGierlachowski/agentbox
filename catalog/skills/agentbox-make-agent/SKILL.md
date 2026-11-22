---
name: agentbox-make-agent
description: Create a new Hermes agent profile (its own SOUL, purpose and a scoped set of skills and MCP servers) from a short description. Use when the user says "make me an agent/bot for X", "I want a reviewer/inbox assistant/ops agent", or wants to list existing agent profiles.
license: MIT
compatibility: Runs on an Agentbox host. Needs the `agentbox` CLI on PATH.
metadata:
  author: agentbox
  version: "1.0"
---

# Create an agent profile

A profile is a separate Hermes persona with its own SOUL.md, memory and toolset. Agentbox
composes its SOUL from the shared base, the box facts and a role template, plus the purpose you
give it. Create profiles only through the API.

Call the API with `agentbox api <procedure> --json '<json input>'`.

## Steps

1. **Existing profiles:** `profiles.list {}`. Do not create a near-duplicate; offer to adjust
   the existing one in the config UI instead.
2. **Understand the job.** From the user's description, settle:
   - `name`: short display name, e.g. "Reviewer".
   - `slug`: lowercase, matches `^[a-z0-9][a-z0-9_-]{0,63}$`, not `default`, unique.
   - `role`: one of `orchestrator`, `developer`, `manager`, `ops`, `support`, `data`,
     `designer` (the SOUL role template).
   - `purpose`: one or two sentences: what it does, for whom, and what it must not do.
   - `skills` and `mcps`: the smallest set of catalog ids it needs, e.g. `skill.github`,
     `mcp.sentry`. Only ids that are already installed: check with `system.info {}`; if
     something is missing, offer the `agentbox-add-tool` skill first.
3. **Confirm.** Show the draft as a short card (name, slug, role, purpose, skills, MCP servers)
   and wait for a yes or edits.
4. **Create:**

   ```bash
   agentbox api profiles.create --json '{"slug":"reviewer","name":"Reviewer","role":"developer","purpose":"Reviews open pull requests in my repos and summarizes risks. Never merges or pushes.","skills":["skill.github","skill.requesting-code-review"],"mcps":["mcp.github"]}'
   ```

5. **Verify:** `profiles.list {}` shows the new profile. Then a quick ping:
   `hermes -p <slug> chat -q ping` should answer.
6. **Schedules (optional).** If the job is recurring (a morning brief, a daily PR sweep),
   suggest a cron in words (schedule, prompt, where to deliver). Do not enable it yourself; the
   user turns it on in Hermes when they are happy with it.

## Rules

- Keep tool scopes minimal. Outward-facing actions (sending mail, posting, merging, paying) stay
  "ask first" in the purpose.
- Never put secrets, tokens or personal data beyond what the user gave into the purpose.
