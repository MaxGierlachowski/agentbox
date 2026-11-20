#!/bin/sh
# Playwright MCP with agentbox defaults. Agents get it as the MCP server "browser".
# Headless Chromium inside the agent's own container, so http://localhost:<port> reaches the
# dev server the agent just started. Screenshots come back to the model as images.
exec node /opt/agentbox/playwright-mcp/cli.js \
  --browser chromium \
  --headless \
  --no-sandbox \
  --isolated \
  --viewport-size "${AGENTBOX_BROWSER_VIEWPORT:-1440x900}" \
  --output-dir "${AGENTBOX_BROWSER_OUTPUT_DIR:-/tmp/agentbox-browser}" \
  --output-max-size 209715200 \
  --file-paths absolute \
  "$@"
