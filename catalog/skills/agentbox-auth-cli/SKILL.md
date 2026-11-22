---
name: agentbox-auth-cli
description: Sign the box's gh (GitHub) or glab (GitLab) CLI in with a device code, and check which CLIs are signed in. Use when a task fails because gh/glab is not authenticated, when the user says "log in to GitHub/GitLab", or after installing gh or glab.
license: MIT
compatibility: Runs on an Agentbox host. Needs the `agentbox` CLI on PATH.
metadata:
  author: agentbox
  version: "1.0"
---

# Sign in a CLI

The login runs inside agentbox (in a pseudo-terminal it owns), so tokens go straight into the
CLI's own credential store and never pass through this chat. Do not run `gh auth login` or
`glab auth login` yourself, and never ask the user for a token.

Call the API with `agentbox api <procedure> --json '<json input>'`.

## Steps

1. **Check.** `clis.status {}` lists the installed CLIs and whether each is signed in (and as
   whom). If the CLI is already signed in to the right host, say so and stop.
2. **Not installed?** Install it first with the `agentbox-add-tool` skill (`cli.gh`/`cli.glab`).
3. **Start the device flow.**
   - GitHub: `clis.authStart {"cli": "gh"}`
   - GitLab.com: `clis.authStart {"cli": "glab"}`
   - Self-managed GitLab: `clis.authStart {"cli": "glab", "host": "gitlab.example.com"}`

   The result has `url` and `code`. Tell the user exactly:
   "Open <url> and enter the code **<code>**." The code expires after a few minutes.
4. **Wait.** Poll `clis.status {}` every 5 seconds for up to 15 minutes. Do not poll faster and
   do not start a second flow while one is pending. When it shows the CLI as signed in, confirm
   with the account name ("Signed in to GitHub as @name").
5. **Timeout or error.** If the code expired, start again once. If it fails twice, suggest the
   config UI page "Connect accounts" and the `agentbox-doctor` skill.

## Notes

- The GitHub login asks for the `admin:public_key` scope so agentbox can register the box's SSH
  key (`agentbox-ssh`). The user may see that scope on the consent page; it is expected.
- GitLab device login needs GitLab 17.9 or newer. For older self-managed GitLab, the user adds a
  personal access token in the config UI instead.
- Other CLIs (aws, gcloud) are signed in from the config UI page "Connect accounts".
- Git identity (name and email) is taken from the GitHub profile or set in the config UI.
