// Resolves the Playwright copy bundled with the globally installed Playwright MCP, so the
// browser revision always matches the one installed into PLAYWRIGHT_BROWSERS_PATH.
import { createRequire } from "node:module"

const require = createRequire("/opt/agentbox/playwright-mcp/package.json")
export const { chromium } = require("playwright")
