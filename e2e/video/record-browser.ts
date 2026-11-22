// Records the browser part of the setup video against a freshly installed box: claim with the
// console code → every onboarding step → install → Hermes UI with the first task → Devices QR.
// Logins are only started (the real Claude link and GitHub code are shown), never completed.
//
//   BOX=https://127.0.0.1:8443 OTP="word word …" bun e2e/video/record-browser.ts
//
// Output in $OUT (default e2e/video/out): browser.webm and browser.json (chapters, time-lapse
// ranges and highlight ranges in seconds from the start of the video).
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect, type Locator, type Page } from "@playwright/test"

const BOX = process.env.BOX ?? "https://127.0.0.1:8443"
const OTP = (process.env.OTP ?? "").trim().replaceAll("-", " ")
const PASSWORD = process.env.DEMO_PASSWORD ?? "agentbox-demo-only-2026"
const OUT = process.env.OUT ?? join(import.meta.dir, "out")
const SIZE = { width: 1440, height: 900 }
if (!OTP) throw new Error("Set OTP to the one-time code `agentbox up` printed")

await rm(join(OUT, "raw"), { recursive: true, force: true })
await mkdir(join(OUT, "raw"), { recursive: true })

// A visible cursor and click ripples (Playwright videos don't show the OS cursor).
const cursorScript = () => {
  const install = () => {
    if (document.getElementById("__demo_cursor")) return
    const c = document.createElement("div")
    c.id = "__demo_cursor"
    const last = JSON.parse(sessionStorage.getItem("__demo_cursor") ?? "[-100,-100]") as [
      number,
      number,
    ]
    Object.assign(c.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "26px",
      height: "26px",
      pointerEvents: "none",
      zIndex: "2147483647",
      transform: `translate(${last[0] - 4}px, ${last[1] - 3}px)`,
    })
    c.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5l6.8 18 2.4-7.4 7.3-2.6z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.documentElement.appendChild(c)
    addEventListener(
      "mousemove",
      (e) => {
        c.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 3}px)`
        sessionStorage.setItem("__demo_cursor", JSON.stringify([e.clientX, e.clientY]))
      },
      true,
    )
    addEventListener(
      "mousedown",
      (e) => {
        const r = document.createElement("div")
        Object.assign(r.style, {
          position: "fixed",
          left: `${e.clientX - 20}px`,
          top: `${e.clientY - 20}px`,
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          background: "rgba(79,70,229,.25)",
          border: "2px solid rgba(79,70,229,.9)",
          pointerEvents: "none",
          zIndex: "2147483646",
          transition: "transform .55s ease-out, opacity .55s ease-out",
        })
        document.documentElement.appendChild(r)
        requestAnimationFrame(() => {
          r.style.transform = "scale(1.9)"
          r.style.opacity = "0"
        })
        setTimeout(() => r.remove(), 700)
      },
      true,
    )
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install)
  else install()
}

const browser = await chromium.launch({ slowMo: 60 })
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: SIZE,
  deviceScaleFactor: 1,
  recordVideo: { dir: join(OUT, "raw"), size: SIZE },
})
await context.addInitScript(cursorScript)
const page = await context.newPage()
const t0 = Date.now()
const now = () => (Date.now() - t0) / 1000

const chapters: { id: string; start: number }[] = []
const fast: { from: number; to: number; factor: number }[] = []
const highlights: { from: number; to: number; label: string }[] = []
const chapter = (id: string) => {
  chapters.push({ id, start: now() })
  console.log(`▶ ${id}`)
}
const pause = (ms: number) => page.waitForTimeout(ms)
let hl: { from: number; label: string } | null = null
const highlight = (label: string) => {
  hl = { from: now(), label }
}
const endHighlight = () => {
  if (hl) highlights.push({ ...hl, to: now() })
  hl = null
}

/** Glides the cursor to the element, then clicks it. */
async function click(target: Locator, hold = 350) {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 })
    await pause(hold)
  }
  await target.click()
}

async function type(target: Locator, text: string, delay = 45) {
  await click(target, 150)
  await target.pressSequentially(text, { delay })
}

const next = (p: Page) => p.getByRole("button", { name: /^(Continue|Done)$/ })

// ---- Erster Login -------------------------------------------------------------------------------
chapter("login")
await page.goto(`${BOX}/setup/`)
await pause(1500)
highlight("claim")
const code = page.getByLabel("One-time code")
await code.fill("")
await type(code, OTP, 55)
await type(page.getByLabel("Your name"), "Demo Owner")
await type(page.getByLabel("Email"), "owner@example.org")
await type(page.getByLabel("Password", { exact: true }), PASSWORD, 30)
await pause(800)
await click(page.getByRole("button", { name: "Claim this box" }))
await expect(page).toHaveURL(/\/onboarding\//, { timeout: 30_000 })
await pause(1800)
endHighlight()

// ---- Onboarding: AI + role -----------------------------------------------------------------------
chapter("onboarding")
await click(page.getByRole("button", { name: "Add account" }))
await click(page.getByRole("button", { name: "Start sign-in" }))
const claudeLink = page.getByRole("link", { name: /Open claude\.ai/ })
await expect(claudeLink).toBeVisible({ timeout: 30_000 })
highlight("claude-link")
await claudeLink.hover()
await pause(3500)
endHighlight()
const hermesSub = page.getByRole("radio", { name: /Claude subscription/ })
if (await hermesSub.isVisible()) {
  await click(hermesSub)
  await pause(1500)
}
await click(next(page))
await pause(1200)
await click(page.getByRole("button", { name: /Developer/ }))
await click(page.getByRole("button", { name: /Manager/ }))
await type(
  page.getByLabel(/Describe your work/),
  "I build a small SaaS and review pull requests.",
  30,
)
await pause(1000)
await click(next(page))

// ---- Toolkit -------------------------------------------------------------------------------------
chapter("toolkit")
await expect(page.getByRole("checkbox", { name: "GitHub CLI" })).toBeChecked({ timeout: 30_000 })
await pause(2000)
await page.mouse.wheel(0, 500)
await pause(1800)
await page.mouse.wheel(0, -500)
await pause(800)
highlight("toolkit-search")
const search = page.getByRole("combobox", { name: "Search the library" })
await type(search, "linear", 120)
const linear = page.getByRole("option", { name: /Linear/ }).first()
await expect(linear).toBeVisible({ timeout: 15_000 })
await pause(2500)
await click(linear)
await pause(1500)
endHighlight()
await search.fill("")
await click(next(page))
await expect(page.getByText("Generated by agentbox")).toBeVisible({ timeout: 30_000 })
await pause(2500)
await page.mouse.wheel(0, 400)
await pause(2000)
await click(next(page))
const github = page.getByRole("region", { name: "GitHub", exact: true })
await click(github.getByRole("button", { name: "Sign in to GitHub" }))
await expect(github.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)).toBeVisible({ timeout: 30_000 })
highlight("github-code")
await pause(4000)
endHighlight()
await page.mouse.wheel(0, 500)
await pause(2000)
await click(next(page))
await click(page.getByRole("button", { name: "Generate ed25519 key" }))
await expect(page.getByText(/^ssh-ed25519 /)).toBeVisible({ timeout: 30_000 })
await pause(3000)
await click(next(page))

// ---- Agents + browser ----------------------------------------------------------------------------
chapter("agents")
const create = page.getByRole("button", { name: /^Create (all|agent)$/ }).first()
await expect(create).toBeVisible({ timeout: 180_000 })
await pause(2500)
await click(create)
await expect(page.getByText(/created/).first()).toBeVisible({ timeout: 120_000 })
await pause(1500)
await click(next(page))
await expect(page.frameLocator("iframe").first().locator("canvas:visible").first()).toBeVisible({
  timeout: 60_000,
})
highlight("browser")
await pause(4000)
endHighlight()
// "Open full screen" shows the same stream in a whole window (here in the same tab).
const fullScreen = page.getByRole("link", { name: /Open full screen/ })
const streamUrl = await fullScreen.getAttribute("href")
const linkBox = await fullScreen.boundingBox()
if (linkBox)
  await page.mouse.move(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2, {
    steps: 20,
  })
await pause(700)
await page.goto(new URL(streamUrl ?? "/browser/", BOX).href)
await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60_000 })
// KasmVNC shows its side panel and a codec notice right after connecting; let them fade.
await page.mouse.move(900, 450, { steps: 10 })
await pause(3500)
highlight("browser-full")
await pause(5000)
endHighlight()
await page.goBack()
await expect(next(page)).toBeVisible({ timeout: 30_000 })
await pause(1000)
await click(next(page))

// ---- Install + Hermes UI -------------------------------------------------------------------------
chapter("hermes")
await pause(1500)
const install = page.getByRole("button", { name: /^Install/ })
if (await install.isVisible()) {
  await click(install)
  const started = now()
  await expect(page.getByText(/^(Succeeded|Failed)$/).first()).toBeVisible({ timeout: 600_000 })
  const ended = now()
  if (ended - started > 8) fast.push({ from: started + 2, to: ended - 1, factor: 8 })
  highlight("install-done")
  await pause(3000)
  endHighlight()
}
await click(page.getByRole("button", { name: /Open Hermes UI/ }).first())
await expect(page).toHaveURL(/\/hermes\//, { timeout: 60_000 })
await pause(2500)
highlight("hermes-ui")
const send = page.getByRole("button", { name: /send/i }).first()
const sendBox = (await send.isVisible()) ? await send.boundingBox() : null
if (sendBox)
  await page.mouse.move(sendBox.x + sendBox.width / 2, sendBox.y + sendBox.height / 2, {
    steps: 25,
  })
await pause(4500)
endHighlight()
await page.goto(`${BOX}/`)
await pause(4000)

// ---- Handy koppeln -------------------------------------------------------------------------------
chapter("pair")
await page.goto(`${BOX}/devices/?pair=1`)
const dialog = page.getByRole("dialog", { name: "Pair a device" })
await expect(dialog.locator("svg[data-slot=qr-code]")).toBeVisible({ timeout: 30_000 })
highlight("qr")
await pause(4500)
endHighlight()
await click(dialog.getByRole("tab", { name: "Laptop" }))
await pause(3500)
chapter("end")

const video = page.video()
await context.close()
await browser.close()
if (video) await rename(await video.path(), join(OUT, "browser.webm"))
await writeFile(
  join(OUT, "browser.json"),
  `${JSON.stringify({ chapters, fast, highlights }, null, 2)}\n`,
)
console.log(`browser recording → ${join(OUT, "browser.webm")}`)
