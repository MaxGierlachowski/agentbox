---
name: agentbox-onboard
description: Set up or re-run the setup of this Agentbox by chatting instead of using the setup wizard. Use when the user wants to (re)configure the box, says "set up my box", "onboard me", "change my role/toolkit", or a fresh box has no toolkit yet. Picks a role bundle, installs skills/MCP servers/CLIs, connects accounts, SSH and repos, and drafts agents, all through the local agentbox API.
license: MIT
compatibility: Runs on an Agentbox host. Needs the `agentbox` CLI on PATH.
metadata:
  author: agentbox
  version: "1.0"
---

# Agentbox onboarding (conversational)

The same steps as the onboarding wizard in the config UI, done in chat. Every change goes
through the local API; never edit config files, systemd units or Hermes/Paseo config by hand.

## Calling the API

```bash
agentbox api <procedure> --json '<json input>'
```

The command prints JSON. A non-zero exit code means the call failed; show the error message to
the user in one sentence and stop that step. Procedures without input take `--json '{}'`.

## Ground rules

- Ask one question at a time and keep it short. Offer sensible defaults.
- **Never ask the user to paste a password, token, API key or client secret into chat.** Secrets
  are entered only in the config UI (page "Connect accounts"), which stores them encrypted.
- Show what will be installed before installing it, and get a clear yes.
- The user can stop at any point; everything can be re-run later.

## Steps

1. **Where are we?** Call `onboarding.get` and `system.info`. Skip steps that are already done
   and tell the user what is already set up (roles, installed items, accounts, repos, agents).

2. **Who is the user?** Ask which roles fit (several allowed): developer, manager, founder-ops,
   data, devops, support, designer-marketer, custom. Ask for one sentence about their work, and
   their timezone and language if `onboarding.get` does not have them.

3. **Pick the toolkit.** For each role, find its bundle with
   `catalog.search {"q": "<role>", "kind": "bundle"}` and read it with
   `catalog.get {"id": "<bundle id>"}`. The `base` bundle is always included. Merge the bundles'
   `skills`, `mcps` and `clis`; leave ids listed in `opt_in` unticked unless the user's sentence
   asks for them. Use the user's sentence to suggest at most a few extra items
   (`catalog.search {"q": "..."}`); only suggest ids that the catalog returns.
   Present the result as three short lists (skills, MCP servers, CLIs) with one line each, and
   mark items that need an account or key.

4. **Install.** After the user agrees, call `toolkit.apply {"add": [ids], "remove": []}`. It
   returns a run id. Poll `runs.get {"id": "<run id>"}` every 10 seconds until the run is
   finished, and report success or the first error. Do not start a second apply while one runs.

5. **Connect accounts.** For `gh` and `glab`, use the `agentbox-auth-cli` skill. For MCP servers
   that need OAuth or an API key, send the user to the config UI page "Connect accounts", which
   shows one card per item. Wait until they say they are done, then check with `system.doctor`.

6. **SSH and repos.** If the user works with GitHub or GitLab, run the `agentbox-ssh` skill, then
   the `agentbox-repo-setup` skill for the repos they pick.

7. **Agents.** Offer one to three agent profiles that fit the roles (for example a reviewer for
   developers, an inbox assistant for managers). Create the ones the user accepts with the
   `agentbox-make-agent` skill.

8. **Browser logins and phone.** Tell the user that the shared browser is in the config UI under
   "Browser", where they can log in to the sites their tools need. Offer phone pairing: call
   `devices.pairStart` and show the pairing link or code it returns.

9. **First task.** Suggest the bundle's `first_task` and its three alternatives, and ask which
   one to start with.

## Done when

`onboarding.get` reports the steps the user chose as complete, `system.doctor` shows no failures
for the installed items, and the user has a first task running.
