---
name: agentbox-add-tool
description: Find and install (or remove) a skill, MCP server or CLI on this Agentbox from the catalog. Use when the user asks to "add Sentry", "install the GitHub MCP", "I need kubectl", "remove Notion", or a task needs a tool that is not installed yet.
license: MIT
compatibility: Runs on an Agentbox host. Needs the `agentbox` CLI on PATH.
metadata:
  author: agentbox
  version: "1.0"
---

# Add or remove a tool

Tools are installed only through the agentbox API, which pins versions, stores secrets
encrypted and registers the tool with Hermes and Paseo. Never run `npm install -g`,
`hermes mcp add`, `apt install` or edit `config.yaml` yourself for this.

Call the API with `agentbox api <procedure> --json '<json input>'`; it prints JSON and exits
non-zero on errors.

## Add

1. **Search.** `catalog.search {"q": "<what the user asked for>"}`. Narrow with
   `"kind": "skill" | "mcp" | "cli"` if the user named a kind. If nothing fits, say so and stop;
   do not invent ids or install from elsewhere.
2. **Pick.** If several items match, show up to five as one line each: name, kind, tier
   (T0 curated, T1 official, T2 community, T3 unverified), licence, and whether it needs an
   account. Prefer T0/T1. Items of tier T3 need an explicit "yes, unverified is fine".
3. **Show the diff.** `catalog.get {"id": "<id>"}` and tell the user, before installing:
   - what runs: the command and package version, or the hosted URL;
   - what it needs: `requires` (other items that will be installed too), `auth.type`, and the
     names of `env` values (never their values);
   - `notes`, if any (account requirements, caveats).
4. **Install** after a clear yes: `toolkit.apply {"add": ["<id>", ...], "remove": []}`. Include
   the ids in `requires` that are not installed yet. The call returns a run id; poll
   `runs.get {"id": "<run id>"}` every 10 seconds until it finishes, then report the result. On
   failure, show the first error line and suggest the `agentbox-doctor` skill.
5. **Connect.** Depending on `auth.type`:
   - `none`: nothing to do.
   - `device` (gh, glab): use the `agentbox-auth-cli` skill.
   - `derived`: make sure the item named in `auth.from` is installed and signed in.
   - `api_key` or `oauth`: send the user to the config UI page "Connect accounts". **Never ask
     for keys, tokens or client secrets in chat.**
6. **Verify.** Call `system.doctor` and report the line for the new tool. New MCP servers are
   available in the next Hermes session.

## Remove

Confirm with the user, then `toolkit.apply {"add": [], "remove": ["<id>"]}` and follow the run
as above. Mention items that other installed items still require.
