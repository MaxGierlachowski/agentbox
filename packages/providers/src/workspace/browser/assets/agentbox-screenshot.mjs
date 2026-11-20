#!/usr/bin/env node
// Screenshot helper for agents without an MCP browser (or for scripts):
//
//   agentbox-screenshot http://localhost:3000 [out.png] [--full-page] [--viewport 1440x900]
//                       [--wait-for <css selector>] [--timeout 30000]
//
// Prints a JSON summary (HTTP status, title, console errors, failed requests) so an agent can
// tell a broken page from a working one, then view the PNG.
import { parseArgs } from "node:util"
import { chromium } from "./playwright.mjs"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "full-page": { type: "boolean", default: false },
    viewport: { type: "string", default: process.env.AGENTBOX_BROWSER_VIEWPORT ?? "1440x900" },
    "wait-for": { type: "string" },
    timeout: { type: "string", default: "30000" },
  },
})
const [url, out = `/tmp/agentbox-browser/screenshot-${Date.now()}.png`] = positionals
if (!url) {
  console.error(
    "usage: agentbox-screenshot <url> [out.png] [--full-page] [--viewport WxH] [--wait-for selector]",
  )
  process.exit(2)
}
const [width, height] = values.viewport.split("x").map(Number)
const timeout = Number(values.timeout)

const browser = await chromium.launch({ headless: true, chromiumSandbox: false })
const consoleErrors = []
const failedRequests = []
let status = null
try {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()))
  page.on("pageerror", (e) => consoleErrors.push(String(e)))
  page.on("requestfailed", (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ""}`))
  const response = await page.goto(url, { waitUntil: "networkidle", timeout })
  status = response?.status() ?? null
  if (values["wait-for"]) await page.waitForSelector(values["wait-for"], { timeout })
  await page.screenshot({ path: out, fullPage: values["full-page"] })
  console.log(
    JSON.stringify(
      {
        ok: status === null || status < 400,
        url,
        status,
        title: await page.title(),
        screenshot: out,
        consoleErrors,
        failedRequests,
      },
      null,
      2,
    ),
  )
  process.exitCode = status !== null && status >= 400 ? 1 : 0
} catch (err) {
  console.log(
    JSON.stringify(
      { ok: false, url, status, error: String(err), consoleErrors, failedRequests },
      null,
      2,
    ),
  )
  process.exitCode = 1
} finally {
  await browser.close()
}
