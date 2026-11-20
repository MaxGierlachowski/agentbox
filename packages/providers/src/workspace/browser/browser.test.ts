import { expect, test } from "bun:test"
import {
  BROWSER_VERSIONS,
  browserBuildContext,
  browserContext,
  browserDockerfile,
  browserMcpServer,
  parseBrowserCheck,
} from "./index"

test("dockerfile fragment pins Playwright MCP and installs Playwright's Chromium, not the snap", () => {
  const lines = browserDockerfile().join("\n")
  expect(lines).toContain(`@playwright/mcp@${BROWSER_VERSIONS.playwrightMcp}`)
  expect(lines).toContain("install --with-deps chromium")
  expect(lines).toContain("fonts-noto-color-emoji")
  expect(lines).not.toContain("chromium-browser")
  expect(lines).toMatchSnapshot()
})

test("viewport is configurable", () => {
  expect(browserDockerfile({ viewport: "1280x720" }).join("\n")).toContain(
    "AGENTBOX_BROWSER_VIEWPORT=1280x720",
  )
})

test("build context ships every script the fragment references", () => {
  const files = Object.keys(browserBuildContext())
  const fragment = browserDockerfile().join("\n")
  for (const name of ["agentbox-browser-mcp.sh", "agentbox-screenshot.mjs"]) {
    expect(files).toContain(name)
    expect(fragment).toContain(name)
  }
  expect(files).toContain("browser-check.mjs")
  expect(browserBuildContext()["agentbox-browser-mcp.sh"]).toContain("--headless")
})

test("MCP server is registered as 'browser'", () => {
  expect(browserMcpServer()).toEqual({
    name: "browser",
    transport: "stdio",
    command: "agentbox-browser-mcp",
    args: [],
  })
})

test("check output parsing adds remediation hints", () => {
  const result = parseBrowserCheck(
    `noise\n${JSON.stringify({
      screenshot: "/tmp/x.png",
      checks: [
        { id: "browser.launch", status: "ok", message: "started" },
        { id: "browser.fonts", status: "fail", message: "CJK 0 px" },
      ],
    })}`,
  )
  expect(result.screenshot).toBe("/tmp/x.png")
  expect(result.checks[1]?.hint).toContain("fonts-noto-cjk")
})

test("unreadable output becomes a failed check", () => {
  expect(parseBrowserCheck("Segmentation fault").checks[0]?.status).toBe("fail")
})

test("agent context explains how to verify UI work", () => {
  const md = browserContext()
  expect(md).toContain("browser_take_screenshot")
  expect(md).toContain("agentbox-screenshot")
  expect(md).toContain("localhost")
})
