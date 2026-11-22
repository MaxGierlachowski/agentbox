---
name: agentbox-ssh
description: Create the box's SSH key and register it with GitHub or GitLab so agents can clone and push over SSH. Use when cloning fails with "Permission denied (publickey)", when the user asks to set up SSH or add the box's key to GitHub/GitLab, or before cloning private repos.
license: MIT
compatibility: Runs on an Agentbox host. Needs the `agentbox` CLI on PATH.
metadata:
  author: agentbox
  version: "1.0"
---

# SSH key for GitHub and GitLab

Call the API with `agentbox api <procedure> --json '<json input>'`.

## Steps

1. **Check.** `ssh.status {}` shows whether a key exists, its public key and fingerprint, and on
   which hosts it is registered.
2. **Create** only if there is no key: `ssh.generate {}` (ed25519, owned by the agentbox user).
   Never overwrite or delete an existing key, and never read, print or copy the private key.
   If the user wants to rotate a key, explain that this is done in the config UI.
3. **Register.** For each host the user works with:
   - `ssh.register {"host": "github.com"}` (needs `gh` signed in with the `admin:public_key`
     scope)
   - `ssh.register {"host": "gitlab.com"}` (needs `glab` signed in)

   If the CLI is not signed in, run the `agentbox-auth-cli` skill first. If registration is not
   possible, show the public key from `ssh.status` and tell the user where to paste it:
   GitHub → Settings → SSH and GPG keys; GitLab → Preferences → SSH Keys.
4. **Verify.** Call `ssh.status {}` again, then test the connection:

   ```bash
   ssh -T -o StrictHostKeyChecking=accept-new git@github.com   # or git@gitlab.com
   ```

   GitHub answers "Hi <user>! You've successfully authenticated" (exit code 1 is normal there);
   GitLab answers "Welcome to GitLab, @<user>!".

## Rules

- Only the public key may be shown or shared.
- Do not add keys to other hosts or accounts than the user asked for.
