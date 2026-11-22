---
name: agentbox-doctor
description: Diagnose and fix problems on this Agentbox - services down, MCP servers not connecting, expired CLI logins, SSH or clone failures, browser not reachable, low disk, failed installs. Use when something on the box "doesn't work", a tool call fails with connection or auth errors, or the user asks for a health check.
license: MIT
compatibility: Runs on an Agentbox host. Needs the `agentbox` CLI on PATH.
metadata:
  author: agentbox
  version: "1.0"
---

# Box health check

Call the API with `agentbox api <procedure> --json '<json input>'`.

## Steps

1. **Run the checks:** `system.doctor {}`. Each check has an id, a status (ok, warn or fail) and
   a message. Also read `system.info {}` for versions, disk and uptime.
2. **Add detail where relevant:**
   - CLI logins: `clis.status {}`
   - SSH: `ssh.status {}`
   - Shared browser: `browser.status {}`
   - A failed install or apply: `runs.get {"id": "<run id>"}` and read its last error lines.
3. **Report** in this order: failures, then warnings, one line each with the likely cause.
   Skip the "ok" checks unless the user asked for everything.
4. **Fix, one problem at a time, with the matching skill:**

   | Problem | Fix |
   |---|---|
   | gh/glab not signed in or token expired | `agentbox-auth-cli` |
   | `Permission denied (publickey)` | `agentbox-ssh` |
   | Tool missing or install failed | `agentbox-add-tool` (re-apply the item) |
   | MCP server needs OAuth again or a key | config UI → "Connect accounts" |
   | Browser not reachable on 127.0.0.1:9333 | report it; the browser service is managed by agentbox |
   | Disk almost full | list the biggest dirs under `/home/agentbox/work` and ask before deleting anything |

5. **Re-check** with `system.doctor {}` after each fix and say what changed.

## Rules

- Diagnose before changing anything. Explain the cause in plain words.
- Do not edit config files, systemd units or credential stores by hand, and do not restart
  services yourself; agentbox owns them. If a restart is needed, tell the user what to run.
- Never print tokens, keys or the contents of credential files, even in error output; redact
  them as `***`.
- Never delete files, repos or keys without an explicit yes.
