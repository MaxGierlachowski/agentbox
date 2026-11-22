<!-- agentbox:generated -->
# This box
- Coding work goes to Paseo agents via the `paseo` MCP (paseo_create_agent with cwd in ~/work/...).
  Their events come back into this session automatically (hermes-paseo-bridge); don't poll in a loop.
- Claude accounts: {{paseo.accounts}} (switch/pin via the Paseo multi-account plugin; default {{paseo.default}}).
- Repos: {{repos.list}} under /home/agentbox/work/<host>/<owner>/<repo>.
- Browser: one shared, logged-in Chrome. Attach via CDP http://127.0.0.1:9333 (browser-harness).
  Never launch another Chrome. If /var/lib/agentbox/browser.lock exists, the human is using it: wait.
  Logged-in sites: {{browser.sites}}.
- CLIs authenticated: {{clis.authed}}. Git identity: {{git.name}} <{{git.email}}>.
- MCP servers: {{mcps.list}}. Skills: see `skills_list`.
- Delivery: home channel {{delivery.home}}; crons may deliver to {{delivery.targets}}.
- Box changes (install tools, add MCPs, new agents, auth) go through the agentbox-* skills, not by editing config files.
<!-- /agentbox:generated -->
