import { expect, test } from "bun:test"
import { openDb } from "@workspace/infra/db"
import { loadConfig } from "../config"
import { Auth } from "./auth"

const setup = (overrides = {}) => {
  const db = openDb(":memory:")
  const config = loadConfig("production", { allowedUsers: ["max@example.com"], ...overrides })
  return new Auth(db, config, "cli-secret-token")
}
const h = (init: Record<string, string>) => new Headers(init)

test("tailscale listener trusts identity headers only for allowed logins", () => {
  const auth = setup()
  expect(
    auth.resolve("tailscale", h({ "tailscale-user-login": "max@example.com" }), undefined),
  ).toEqual({
    login: "max@example.com",
    name: null,
    via: "tailscale",
  })
  expect(
    auth.resolve("tailscale", h({ "tailscale-user-login": "eve@example.com" }), undefined),
  ).toBeNull()
  expect(auth.resolve("tailscale", h({}), undefined)).toBeNull()
})

test("local listener ignores tailscale identity headers", () => {
  const auth = setup()
  expect(
    auth.resolve("local", h({ "tailscale-user-login": "max@example.com" }), undefined),
  ).toBeNull()
})

test("cli bearer token", () => {
  const auth = setup()
  expect(
    auth.resolve("local", h({ authorization: "Bearer cli-secret-token" }), undefined)?.via,
  ).toBe("cli")
  expect(auth.resolve("local", h({ authorization: "Bearer wrong" }), undefined)).toBeNull()
})

test("login links are single use and create a session", () => {
  const auth = setup()
  const link = auth.createLoginLink("max")
  const session = auth.redeemLoginLink(link)
  expect(session).toBeString()
  expect(auth.redeemLoginLink(link)).toBeNull()
  expect(auth.resolve("local", h({}), session ?? undefined)).toEqual({
    login: "max",
    name: null,
    via: "session",
  })
  auth.revokeSession(session ?? "")
  expect(auth.resolve("local", h({}), session ?? undefined)).toBeNull()
})

test("funnel requests never reach the agentbox UI", async () => {
  const { createApp } = await import("./app")
  const { createRouter } = await import("./router")
  const { RunService } = await import("../runs/service")
  const { ToolsService } = await import("../tools/service")
  const { AutomationService } = await import("../automation/service")
  const { SecretStore } = await import("@workspace/infra/secrets")
  const db = openDb(":memory:")
  const config = loadConfig("production", { allowedUsers: ["max@example.com"] })
  const secrets = new SecretStore("/nonexistent", 10)
  const app = createApp({
    config,
    auth: new Auth(db, config, "cli"),
    router: createRouter({
      runs: new RunService(db),
      secrets,
      tools: new ToolsService(db, secrets, { workspace: "default", tailnetHost: () => null }),
      automation: new AutomationService(
        db,
        secrets,
        new ToolsService(db, secrets, { workspace: "default", tailnetHost: () => null }),
        { workspace: "default" },
      ),
      startedAt: new Date(),
    }),
    webRoot: null,
  })
  const req = (headers: Record<string, string>) =>
    app.fetch(
      new Request("http://agentbox-01.tail1234.ts.net:8443/api/rpc/auth/me", {
        headers: { host: "agentbox-01.tail1234.ts.net:8443", ...headers },
      }),
      { listener: "tailscale" },
    )
  expect((await req({ "tailscale-user-login": "max@example.com" })).status).toBe(200)
  const funnel = await req({
    "tailscale-user-login": "max@example.com",
    "tailscale-funnel-request": "?1",
  })
  expect(funnel.status).toBe(404)
})

test("mutations: own origins pass, foreign origins are rejected", async () => {
  const { createApp } = await import("./app")
  const { createRouter } = await import("./router")
  const { RunService } = await import("../runs/service")
  const { ToolsService } = await import("../tools/service")
  const { AutomationService } = await import("../automation/service")
  const { SecretStore } = await import("@workspace/infra/secrets")
  const db = openDb(":memory:")
  const config = loadConfig("development")
  const secrets = new SecretStore("/nonexistent", 10)
  const app = createApp({
    config,
    auth: new Auth(db, config, "cli"),
    router: createRouter({
      runs: new RunService(db),
      secrets,
      tools: new ToolsService(db, secrets, { workspace: "default", tailnetHost: () => null }),
      automation: new AutomationService(
        db,
        secrets,
        new ToolsService(db, secrets, { workspace: "default", tailnetHost: () => null }),
        { workspace: "default" },
      ),
      startedAt: new Date(),
    }),
    webRoot: null,
  })
  // As forwarded by `next dev`: Host is the daemon, Origin is the dev server.
  const post = (origin: string) =>
    app.fetch(
      new Request("http://127.0.0.1:7777/api/rpc/auth/me", {
        method: "POST",
        headers: { host: "127.0.0.1:7777", origin, "content-type": "application/json" },
        body: "{}",
      }),
      { listener: "local" },
    )
  expect((await post("http://localhost:3100")).status).toBe(200)
  expect((await post("https://evil.example")).status).toBe(403)
})
