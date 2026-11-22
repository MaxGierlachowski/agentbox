import { defineConfig, devices } from "@playwright/test"

/**
 * UI tests against `next dev` and the in-memory mock server (no Docker, no real accounts).
 *
 *   bun run --cwd e2e test            # starts both servers unless they already run
 *   WEB_PORT=3100 bun run --cwd e2e test   # reuse a running `bun run dev` against the mock
 */
const WEB_PORT = Number(process.env.WEB_PORT ?? 3199)
export const MOCK_URL = "http://127.0.0.1:7799"

export default defineConfig({
  testDir: "browser",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: "bun mock-server/index.ts",
      url: `${MOCK_URL}/api/setup/status`,
      reuseExistingServer: true,
      stdout: "ignore",
    },
    {
      command: `bunx next dev --port ${WEB_PORT}`,
      cwd: "../apps/web",
      url: `http://localhost:${WEB_PORT}/login/`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { AGENTBOX_API: MOCK_URL, NEXT_TELEMETRY_DISABLED: "1" },
    },
  ],
})
