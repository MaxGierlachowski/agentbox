/// <reference path="./assets.d.ts" />
// Browser capability for workspaces: headless Chromium plus Playwright MCP inside the workspace
// image and in the Paperclip image, so every agent (CLI agents in the workspace container, agents
// started by Paperclip) can open its own dev server on localhost and look at screenshots.
import mcpWrapper from "./assets/agentbox-browser-mcp.sh" with { type: "text" }
import screenshotCli from "./assets/agentbox-screenshot.mjs" with { type: "text" }
import checkScript from "./assets/browser-check.mjs" with { type: "text" }
import playwrightShim from "./assets/playwright.mjs" with { type: "text" }

export const BROWSER_VERSIONS = {
  /** Pinned; Renovate bumps it. Brings its own Playwright, whose Chromium we install. */
  playwrightMcp: "0.0.83",
} as const

export interface BrowserOptions {
  /** Default viewport for MCP sessions and the screenshot helper. */
  viewport?: `${number}x${number}`
}

/** Directory inside the Docker build context that `browserBuildContext()` files go to. */
export const BROWSER_CONTEXT_DIR = "browser"
export const SCREENSHOT_DIR = "/tmp/agentbox-browser"

/** Files to place under `<build context>/browser/`. */
export function browserBuildContext(): Record<string, string> {
  return {
    "agentbox-browser-mcp.sh": mcpWrapper,
    "agentbox-screenshot.mjs": screenshotCli,
    "browser-check.mjs": checkScript,
    "playwright.mjs": playwrightShim,
  }
}

/**
 * Dockerfile instructions. Expects Node on PATH (mise toolchain) and runs as root, before the
 * image switches to the unprivileged user. Uses Playwright's Chromium build: Ubuntu's
 * chromium-browser package is a snap and cannot be installed in an image.
 */
export function browserDockerfile(opts: BrowserOptions = {}): string[] {
  const viewport = opts.viewport ?? "1440x900"
  return [
    "# --- browser: headless Chromium + Playwright MCP for agent screenshots",
    "ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \\",
    `    AGENTBOX_BROWSER_VIEWPORT=${viewport} \\`,
    `    AGENTBOX_BROWSER_OUTPUT_DIR=${SCREENSHOT_DIR}`,
    "RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\",
    "    --mount=type=cache,target=/var/lib/apt,sharing=locked \\",
    "    apt-get update && apt-get install -y --no-install-recommends \\",
    "      fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji",
    `RUN npm install -g --no-fund --no-audit @playwright/mcp@${BROWSER_VERSIONS.playwrightMcp} \\`,
    ' && mkdir -p /opt/agentbox && ln -sfn "$(npm root -g)/@playwright/mcp" /opt/agentbox/playwright-mcp \\',
    " && PW_CLI=\"$(node -p \"require.resolve('playwright/package.json',{paths:['/opt/agentbox/playwright-mcp']}).replace('package.json','cli.js')\")\" \\",
    ' && node "$PW_CLI" install --with-deps chromium \\',
    " && rm -rf /var/lib/apt/lists/* \\",
    " && chmod -R a+rX /ms-playwright",
    `COPY ${BROWSER_CONTEXT_DIR}/ /opt/agentbox/browser/`,
    "RUN chmod 0755 /opt/agentbox/browser/*.sh /opt/agentbox/browser/*.mjs \\",
    " && ln -sf /opt/agentbox/browser/agentbox-browser-mcp.sh /usr/local/bin/agentbox-browser-mcp \\",
    " && ln -sf /opt/agentbox/browser/agentbox-screenshot.mjs /usr/local/bin/agentbox-screenshot \\",
    ` && install -d -m 1777 ${SCREENSHOT_DIR}`,
  ]
}

/** Compose settings for containers that run the browser. */
export const browserComposeService = {
  // Chromium needs more than Docker's default 64 MB /dev/shm for real-world pages.
  shm_size: "1gb",
} as const

export interface McpServerDef {
  name: string
  transport: "stdio"
  command: string
  args: string[]
}

/** Entry for the spec's `mcp:` registry; enabled for every agent by default. */
export function browserMcpServer(): McpServerDef {
  return { name: "browser", transport: "stdio", command: "agentbox-browser-mcp", args: [] }
}

export const browserVerifyCommand = ["node", "/opt/agentbox/browser/browser-check.mjs"] as const

export interface BrowserCheckResult {
  screenshot: string | null
  checks: { id: string; status: "ok" | "warn" | "fail"; message: string; hint?: string }[]
}

/** Parses the JSON printed by `browser-check.mjs`. Garbage output becomes a failed check. */
export function parseBrowserCheck(stdout: string): BrowserCheckResult {
  try {
    const parsed = JSON.parse(stdout.slice(stdout.indexOf("{"))) as BrowserCheckResult
    if (!Array.isArray(parsed.checks)) throw new Error("missing checks")
    for (const check of parsed.checks) {
      if (check.status === "fail" && check.id === "browser.fonts") {
        check.hint = "Install fonts-noto-cjk and fonts-noto-color-emoji in the image."
      }
      if (check.status === "fail" && check.id === "browser.launch") {
        check.hint = "Rebuild the image; Chromium or its system libraries are missing."
      }
    }
    return parsed
  } catch (err) {
    return {
      screenshot: null,
      checks: [
        { id: "browser.check", status: "fail", message: `Unreadable check output: ${String(err)}` },
      ],
    }
  }
}

/** Section for the generated AGENTS.md. */
export function browserContext(): string {
  return `## Browser and screenshots

A headless Chromium is installed in this container. Use it to check UI work yourself instead of
assuming it renders.

- MCP server \`browser\` (Playwright MCP): \`browser_navigate\`, \`browser_snapshot\`,
  \`browser_take_screenshot\`, \`browser_click\`, \`browser_console_messages\`. Screenshots come back
  as images.
- Without MCP: \`agentbox-screenshot http://localhost:3000 /tmp/agentbox-browser/home.png --full-page\`
  prints HTTP status, console errors and failed requests as JSON; then open the PNG.
- The browser runs in this container, so \`http://localhost:<port>\` reaches the dev server you
  started here. Other services are reachable by name (for example \`http://postgres:5432\`).
- After changing UI: start the dev server, take a screenshot, look at it, check the console for
  errors, and only then report the change as done.
`
}
