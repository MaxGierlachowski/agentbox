---
name: agentbox-browser
description: Use the box's shared, logged-in Chrome for web tasks that need a real browser - logged-in sites, clicking, forms, JS-heavy or bot-protected pages, screenshots. Attaches over CDP at http://127.0.0.1:9333 and never launches its own browser. Use whenever a task needs a browser on this Agentbox. Not for plain public pages that curl or a fetch tool can read.
license: MIT
compatibility: Runs on an Agentbox host. Uses browser-harness or Hermes browser tools; the shared Chrome listens on 127.0.0.1:9333.
metadata:
  author: agentbox
  version: "1.0"
---

# The shared browser

The box runs exactly one Chrome with a persistent profile in which the user has logged in to
their sites. Humans watch and use the same browser through the config UI. Treat it like
someone else's desk: work in your own tabs and leave theirs alone.

## Hard rules

1. **Attach only.** Connect to the CDP endpoint `http://127.0.0.1:9333`. Never start Chrome or
   Chromium, never pass `--remote-debugging-port`, never call Playwright/Puppeteer `launch()`.
   If the endpoint does not answer, stop and report it (see the `agentbox-doctor` skill).
2. **Respect the lock.** While `/var/lib/agentbox/browser.lock` exists, the human has taken
   control. Do not send any CDP command. Check before you start and before every step.
3. **Own tabs only.** Open a new tab for your work and remember its target id. Never navigate,
   type into, reload or close a tab you did not open. Never call `Browser.close`.
4. **Clean up.** Close the tabs you opened when the task is done, unless the user wants to look
   at the result.
5. **No secrets in chat.** If a site asks for a login, 2FA or a captcha, ask the user to do it in
   the config UI ("Browser" page) and wait; never ask for passwords.
6. **Ask before outward-facing actions** (sending, posting, buying, deleting, accepting terms).

## Before you start

```bash
test -e /var/lib/agentbox/browser.lock && echo locked || echo free
curl -fsS http://127.0.0.1:9333/json/version >/dev/null && echo cdp-up || echo cdp-down
```

`agentbox api browser.status --json '{}'` reports the same plus which sites are logged in.

**If locked:** tell the user once ("The browser is in use; I'll continue when you release it"),
then check every 30 seconds for up to 15 minutes. Do not unlock it yourself.
(`browser.setLock` is for the user's explicit "take/release control" request only.)

## With browser-harness

Always pass the endpoint so the harness attaches instead of starting a browser:

```bash
BU_CDP_URL=http://127.0.0.1:9333 browser-harness <<'PY'
tab = new_tab("https://example.com")   # your own tab; reuse it in later calls
wait_for_load()
print(page_info())
PY
```

- First navigation of a task is `new_tab(url)`; later calls reuse that tab (`current_tab()`,
  `list_tabs()`, `switch_tab()`), they do not open new ones.
- Do not call `activate_tab()` (it switches the tab the human sees) unless a page refuses to
  render in the background.
- Close only the tab(s) you created at the end.

## With Hermes browser tools

Hermes is configured with `browser.cdp_url = http://127.0.0.1:9333`, so its browser tools
already attach to the shared Chrome. The same rules apply: open your own tab first, check the
lock between steps, and never close tabs you did not open.

## Paseo / Claude Code agents

Coding agents use the same browser through browser-harness as shown above. For automated UI
tests of an app under development, prefer an isolated headless browser (`mcp.playwright`) so the
user's logged-in profile is never touched.
