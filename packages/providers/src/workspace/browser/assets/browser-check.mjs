#!/usr/bin/env node
// agentbox verify check for the browser capability. Renders a test page with Latin text,
// CJK and emoji, takes a screenshot and reports JSON checks. Exit code 0 means usable.
import { stat } from "node:fs/promises"
import { chromium } from "./playwright.mjs"

const out = process.argv[2] ?? "/tmp/agentbox-browser/browser-check.png"
const html = `<!doctype html><meta charset="utf-8"><title>agentbox browser check</title>
<body style="margin:0;font-family:sans-serif;background:#fff">
<div style="height:120px;background:linear-gradient(90deg,#0ea5e9,#22c55e)"></div>
<h1 id="t" style="margin:24px">agentbox browser check ✓ Grüße 你好 🚀</h1></body>`

const checks = []
const add = (id, ok, message) => checks.push({ id, status: ok ? "ok" : "fail", message })
const started = Date.now()
let browser
try {
  browser = await chromium.launch({ headless: true, chromiumSandbox: false })
  add("browser.launch", true, `Chromium ${browser.version()} started in ${Date.now() - started} ms`)
  const page = await browser.newPage({ viewport: { width: 800, height: 240 } })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  const widths = await page.evaluate(() => {
    const measure = (text) => {
      const s = document.createElement("span")
      s.textContent = text
      document.body.append(s)
      const w = s.getBoundingClientRect().width
      s.remove()
      return w
    }
    return { latin: measure("agentbox"), cjk: measure("你好"), emoji: measure("🚀") }
  })
  add("browser.render", widths.latin > 0, `text renders (${Math.round(widths.latin)} px)`)
  add(
    "browser.fonts",
    widths.cjk > 0 && widths.emoji > 0,
    `CJK ${Math.round(widths.cjk)} px, emoji ${Math.round(widths.emoji)} px`,
  )
  await page.screenshot({ path: out })
  const size = (await stat(out)).size
  add("browser.screenshot", size > 2000, `screenshot ${out} (${size} bytes)`)
} catch (err) {
  add("browser.launch", false, String(err))
} finally {
  await browser?.close()
}
console.log(JSON.stringify({ screenshot: out, checks }, null, 2))
process.exitCode = checks.every((c) => c.status === "ok") ? 0 : 1
