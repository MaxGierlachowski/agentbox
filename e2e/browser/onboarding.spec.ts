import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"

const MOCK = "http://127.0.0.1:7799"
const OTP = "river-lamp-oak-mint-fold-acre"
const PASSWORD = "Tidal-Orbit-Fennel-42"
const API_KEY = "sk-ant-api03-test-key-abcdefghij-9f3k"
const SHOTS = join(import.meta.dirname, "screenshots")
mkdirSync(SHOTS, { recursive: true })

async function shot(page: Page, name: string) {
  const project = test.info().project.name
  // Let toasts and transitions settle so screenshots are comparable.
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(SHOTS, `${project}-${name}.png`), fullPage: true })
}

async function reset(page: Page, preset: "fresh" | "claimed" | "onboarded") {
  const res = await page.request.post(`${MOCK}/__mock/reset`, { data: { preset } })
  expect(res.ok()).toBe(true)
}

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name })
const next = (page: Page) => page.getByTestId("continue")

test("claim, every onboarding step, hand-off to Hermes UI", async ({ page }) => {
  await reset(page, "fresh")

  // ---- gate: an unclaimed box sends everyone to /setup/
  await page.goto("/")
  await expect(page).toHaveURL(/\/setup\/$/)

  // ---- claim with the OTP from the URL fragment
  await page.goto(`/setup/#otp=${OTP}`)
  await expect(page.getByLabel("One-time code")).toHaveValue("river lamp oak mint fold acre")
  await expect(page).toHaveURL(/\/setup\/$/) // fragment removed from the address bar
  await page.getByLabel("Your name").fill("Ada Example")
  await page.getByLabel("Email").fill("ada@example.org")
  await page.getByLabel("Password", { exact: true }).fill("short")
  await expect(page.getByText("Use 12 or more characters.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Claim this box" })).toBeDisabled()
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await expect(page.getByText(/^Strong|^Very strong/)).toBeVisible()
  await shot(page, "01-setup")
  await page.getByRole("button", { name: "Claim this box" }).click()

  // ---- 1. Connect AI
  await expect(page).toHaveURL(/\/onboarding\//)
  await expect(heading(page, "Connect your AI")).toBeVisible()
  await page.getByRole("button", { name: "Add account" }).click()
  await page.getByRole("button", { name: "Start sign-in" }).click()
  await expect(page.getByRole("link", { name: /Open claude\.ai/ })).toBeVisible()
  await page.getByLabel(/Paste the code/).fill("abcd-efgh-1234")
  await page.getByRole("button", { name: "Finish sign-in" }).click()
  await expect(page.getByText("Signed in as personal@example.org")).toBeVisible()
  await page.getByRole("button", { name: "Done" }).click()
  await page.getByLabel("Anthropic").fill(API_KEY)
  await page.getByRole("button", { name: "Save" }).first().click()
  await expect(page.getByText("••••9f3k")).toBeVisible()
  // Write-only: the key never comes back to the page.
  expect(await page.content()).not.toContain(API_KEY)
  // Hermes signs in with its own Claude OAuth (same account, separate login).
  await page.getByRole("radio", { name: /Claude subscription/ }).click()
  await page.getByRole("button", { name: "Sign in for Hermes" }).click()
  await page.getByLabel(/Paste the code/).fill("hermes-code-5678")
  await page.getByRole("button", { name: "Finish sign-in" }).click()
  await expect(page.getByText("Signed in as ada@example.org")).toBeVisible()
  await page.getByRole("button", { name: "Done" }).click()
  await expect(page.getByText(/Now: .*via Claude subscription/)).toBeVisible()
  await page.getByRole("button", { name: "Test Hermes" }).click()
  await expect(page.getByText(/Hermes answered/)).toBeVisible()
  await shot(page, "02-ai")
  await next(page).click()

  // ---- 2. Who are you? (and resume after reload)
  await expect(heading(page, "Who are you?")).toBeVisible()
  await page.goto("/onboarding/")
  await expect(heading(page, "Who are you?")).toBeVisible()
  await page.getByRole("button", { name: /Developer/ }).click()
  await expect(page.getByRole("button", { name: /Developer/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await page.getByLabel(/Describe your work/).fill("I build web apps and review PRs.")
  await shot(page, "03-role")
  await next(page).click()

  // ---- 3. Toolkit: suggestion + library search
  await expect(heading(page, "Your toolkit")).toBeVisible()
  await expect(page.getByRole("checkbox", { name: "GitHub CLI" })).toBeChecked()
  await page
    .getByRole("checkbox", { name: /Postgres/ })
    .first()
    .check()
  await page.getByRole("combobox", { name: "Search the library" }).fill("sentry")
  const result = page.getByRole("option", { name: /Sentry/ }).first()
  await expect(result).toBeVisible()
  await shot(page, "04-toolkit-search")
  await result.click()
  await expect(result.getByText("Added")).toBeVisible()
  await page.getByRole("combobox", { name: "Search the library" }).fill("")
  await shot(page, "04-toolkit")
  await next(page).click()

  // ---- 4. SOUL
  await expect(heading(page, "Your SOUL")).toBeVisible()
  await expect(page.getByText("Generated by agentbox")).toBeVisible()
  const soul = page.getByLabel("Your SOUL.md sections")
  await soul.click()
  await soul.press("End")
  await soul.pressSequentially("\n- Prefer TypeScript.")
  await shot(page, "05-soul")
  await next(page).click()

  // ---- 5. Connect accounts: gh device flow, OAuth MCP, API-key card, git identity
  await expect(heading(page, "Connect accounts")).toBeVisible()
  const github = page.getByRole("region", { name: "GitHub", exact: true })
  await github.getByRole("button", { name: "Sign in to GitHub" }).click()
  await expect(github.getByText("7C2F-9B41")).toBeVisible()
  await shot(page, "06-accounts-device-code")
  await expect(github.getByText("Signed in as @ada-example")).toBeVisible()
  const sentry = page.getByRole("region", { name: "Sentry" })
  await sentry.getByRole("button", { name: /Connect/ }).click()
  await expect(sentry.getByText("Finish signing in in the box browser below.")).toBeVisible()
  await expect(sentry.locator("iframe")).toBeVisible()
  await expect(sentry.getByText(/^Connected/)).toBeVisible()
  const postgres = page.getByRole("region", { name: /Postgres/ })
  await postgres.getByLabel("DATABASE_URI").fill("postgres://readonly:secret@db.internal/app")
  await postgres.getByRole("button", { name: /Save/ }).click()
  await expect(postgres.getByText("Saved and installed")).toBeVisible()
  expect(await page.content()).not.toContain("readonly:secret")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible()
  await shot(page, "06-accounts")
  await next(page).click()

  // ---- 6. SSH & repos: key, register, clone into the run drawer
  await expect(heading(page, "SSH & repos")).toBeVisible()
  await page.getByRole("button", { name: "Generate ed25519 key" }).click()
  await expect(page.getByText(/^ssh-ed25519 /)).toBeVisible()
  await page.getByRole("button", { name: "Add to GitHub" }).click()
  await expect(page.getByText("Added to GitHub", { exact: true })).toBeVisible()
  await page.getByLabel("ada-example/hermes-ui").check()
  await page.getByRole("button", { name: "Clone 1 repo" }).click()
  const drawer = page.getByRole("dialog")
  await expect(drawer.getByText("Cloning repositories")).toBeVisible()
  await expect(drawer.getByText("Succeeded", { exact: true })).toBeVisible()
  await expect(drawer.locator(".xterm-rows")).toContainText("git clone")
  await shot(page, "07-repos-drawer")
  await page.keyboard.press("Escape")
  await expect(page.getByText("Cloned", { exact: true })).toBeVisible()
  await shot(page, "07-repos")
  await next(page).click()

  // ---- 7. Your agents
  await expect(heading(page, "Your agents")).toBeVisible()
  await expect(page.getByRole("article", { name: "Reviewer" })).toBeVisible()
  await shot(page, "08-agents")
  await page.getByRole("button", { name: "Create all" }).click()
  await expect(page.getByText("Created").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Create agent" })).toHaveCount(0)
  await next(page).click()

  // ---- 8. Browser logins (skipped after a look)
  await expect(heading(page, "Browser logins")).toBeVisible()
  await expect(
    page.frameLocator('iframe[title="The box\'s browser"]').getByText("Sign in to GitHub"),
  ).toBeVisible()
  await page.getByLabel("Take control").click()
  await expect(page.getByText("You have control.")).toBeVisible()
  await expect(page.getByText("github.com")).toBeVisible()
  await shot(page, "09-browser")
  await page.getByRole("button", { name: "Skip this step" }).click()

  // ---- 9. Install & hand-off
  await expect(heading(page, "Install & hand-off")).toBeVisible()
  await page.getByTestId("install").click()
  await expect(page.getByTestId("run-log")).toHaveAttribute("data-status", "succeeded", {
    timeout: 30_000,
  })
  await page.getByRole("button", { name: /Show pairing code/ }).click()
  await expect(page.locator("svg[data-slot=qr-code]")).toBeVisible()
  await shot(page, "10-apply")
  const state = await (await page.request.get(`${MOCK}/__mock/state`)).json()
  expect(state.onboarding.skipped).toContain("browser")
  expect(state.onboarding.completed).toEqual(
    expect.arrayContaining(["ai", "role", "toolkit", "soul", "accounts", "repos", "agents"]),
  )
  await next(page).click()
  await expect(page).toHaveURL(/\/hermes\/\?compose=/)
  await expect(page.getByTestId("compose")).not.toHaveText("(empty)")
})

test("skip → open Hermes UI works from the first step", async ({ page }) => {
  await reset(page, "claimed")
  await page.goto("/login/?next=/onboarding/")
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery-staple")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(heading(page, "Connect your AI")).toBeVisible()
  await page.getByTestId("skip-to-hermes").click()
  await expect(page).toHaveURL(/\/hermes\//)
  // Onboarding is finished now, so the console opens instead of the wizard.
  await page.goto("/")
  await expect(page.getByRole("heading", { name: /your box is ready/ })).toBeVisible()
})

test("devices: ?pair=1 opens the pairing dialog, a phone pairs, then gets revoked", async ({
  page,
}) => {
  await reset(page, "onboarded")
  await page.goto("/devices/?pair=1")
  await expect(page).toHaveURL(/\/login\/\?next=/)
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery-staple")
  await page.getByRole("button", { name: "Sign in" }).click()
  const dialog = page.getByRole("dialog", { name: "Pair a device" })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator("svg[data-slot=qr-code]")).toBeVisible()
  await expect(dialog.getByText(/expires in \d+:\d\d/)).toBeVisible()
  await shot(page, "11-devices-pair")
  await dialog.getByRole("tab", { name: "Laptop" }).click()
  await expect(dialog.getByText(/agentbox connect [0-9a-f]+ --code/)).toBeVisible()
  const res = await page.request.post(`${MOCK}/__mock/pair`, { data: { name: "Ada's phone" } })
  expect(res.ok()).toBe(true)
  await expect(dialog.getByText("Ada's phone is paired")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(/\/devices\/$/)
  await expect(page.getByText("Ada's phone")).toBeVisible()
  await shot(page, "12-devices")
  await page.getByRole("button", { name: "Revoke" }).last().click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click()
  await expect(page.getByText("Ada's phone")).toHaveCount(0)
})

test("console pages render", async ({ page }) => {
  await reset(page, "onboarded")
  await page.goto("/login/")
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery-staple")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: /your box is ready/ })).toBeVisible()
  await expect(page.getByText("Hermes agent")).toBeVisible()
  await shot(page, "20-overview")
  for (const [path, title, name] of [
    ["/toolkit/", "Toolkit", "21-toolkit"],
    ["/agents/", "Agents", "22-agents"],
    ["/desktop/", "Browser", "23-desktop"],
    ["/runs/", "Runs", "24-runs"],
    ["/settings/", "Settings", "25-settings"],
  ] as const) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
    await shot(page, name)
  }
  await expect(page.getByText("Disk 81% full")).toBeVisible()
  await page.goto("/reset/")
  await expect(page.getByRole("heading", { name: "Reset the owner password" })).toBeVisible()
  await shot(page, "26-reset")
  await page.goto("/login/")
  await shot(page, "27-login")
})
