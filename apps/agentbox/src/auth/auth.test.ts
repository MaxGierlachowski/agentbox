import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb } from "@workspace/infra/db"
import { type Config, loadConfig, paths } from "../config"
import { DeviceService } from "../devices/service"
import { createApp } from "../server/app"
import { createRouter } from "../server/router"
import type { Services } from "../services"
import { Auth, edgeVia } from "./auth"
import { generateOtp, hashOtp, normalizeOtp } from "./otp"

const PROXY = "proxy-secret-for-tests"
const PHONE1 = "a".repeat(64)
const PHONE2 = "b".repeat(64)
let dir: string
let config: Config

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentbox-auth-"))
  config = loadConfig("production", { dataDir: dir, etcDir: dir, runtimeDir: dir, home: dir })
})
afterEach(() => rm(dir, { recursive: true, force: true }))

function setup() {
  const db = openDb(":memory:")
  const auth = new Auth(db, config, "cli-secret-token")
  const devices = new DeviceService(db, config)
  const router = createRouter({ auth, devices } as unknown as Services)
  const app = createApp({ config, auth, router, devices, proxySecret: () => PROXY, webRoot: null })
  const call = (
    path: string,
    init: Omit<RequestInit, "headers"> & {
      via?: "local" | "lan" | "iroh"
      headers?: Record<string, string>
    } = {},
  ) => {
    const headers: Record<string, string> = { host: "127.0.0.1:7777", ...init.headers }
    if (init.via) {
      headers["x-agentbox-proxy-secret"] = PROXY
      headers["x-agentbox-via"] = init.via
      headers.host = "192.168.1.50:8443"
    }
    return app.fetch(new Request(`http://127.0.0.1:7777${path}`, { ...init, headers }))
  }
  return { db, auth, devices, app, call }
}

const json = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
})

test("OTPs are six words and normalize spaces, dashes and case", () => {
  const otp = generateOtp()
  expect(otp.split(" ")).toHaveLength(6)
  expect(normalizeOtp("River-LAMP  oak,mint fold acre")).toBe("river lamp oak mint fold acre")
  expect(hashOtp("a-b-c")).toBe(hashOtp("A B C"))
})

test("an OTP works once and not after expiry", () => {
  const { auth, db } = setup()
  const { otp } = auth.issueOtp("claim")
  expect(auth.otpValid(otp, "claim")).toBe(true)
  expect(auth.otpValid(otp, "reset")).toBe(false)
  expect(auth.redeemOtp(otp, "claim")).toBe(true)
  expect(auth.redeemOtp(otp, "claim")).toBe(false)
  const second = auth.issueOtp("claim")
  db.$client.exec("UPDATE otps SET expires_at = 0")
  expect(auth.redeemOtp(second.otp, "claim")).toBe(false)
})

test("issuing a new OTP invalidates the previous one", () => {
  const { auth } = setup()
  const first = auth.issueOtp("claim")
  auth.issueOtp("claim")
  expect(auth.otpValid(first.otp, "claim")).toBe(false)
})

test("edge headers count only with the proxy secret", () => {
  expect(edgeVia(new Headers({ "x-agentbox-via": "iroh" }), PROXY)).toBe("direct")
  expect(
    edgeVia(new Headers({ "x-agentbox-via": "iroh", "x-agentbox-proxy-secret": "nope" }), PROXY),
  ).toBe("direct")
  expect(
    edgeVia(new Headers({ "x-agentbox-via": "iroh", "x-agentbox-proxy-secret": PROXY }), PROXY),
  ).toBe("iroh")
  expect(edgeVia(new Headers({ "x-agentbox-proxy-secret": PROXY }), PROXY)).toBe("local")
  expect(edgeVia(new Headers({ "x-agentbox-proxy-secret": PROXY }), null)).toBe("direct")
})

test("claim: OTP + password creates the owner once, then /setup is gone", async () => {
  const { auth, call } = setup()
  const { otp } = auth.issueOtp("claim")
  const body = {
    otp: otp.replaceAll(" ", "-"),
    name: "Ada",
    email: "Ada@Example.com",
    password: "correct horse battery",
  }
  const res = await call("/api/setup/claim", { ...json(body), via: "lan" })
  expect(res.status).toBe(200)
  const cookie = res.headers.get("set-cookie") ?? ""
  expect(cookie).toContain("agentbox_session=")
  expect(cookie).toContain("HttpOnly")
  expect(cookie).toContain("SameSite=Strict")
  expect(cookie).toContain("Secure")
  expect(auth.owner()?.email).toBe("ada@example.com")
  expect((await call("/api/setup/claim", { ...json(body), via: "lan" })).status).toBe(404)
  expect((await call("/setup/", { via: "lan" })).status).toBe(404)
  expect(await (await call("/api/setup/status")).json()).toEqual({ claimed: true })
})

test("claim rejects wrong codes and rate-limits after 5 tries a minute", async () => {
  const { auth, call } = setup()
  auth.issueOtp("claim")
  const body = {
    otp: "wrong words entirely here now ok",
    name: "Ada",
    email: "a@example.com",
    password: "correct horse battery",
  }
  const statuses: number[] = []
  for (let i = 0; i < 6; i++)
    statuses.push(
      (
        await call("/api/setup/claim", {
          ...json(body),
          via: "lan",
          headers: { "x-forwarded-for": "10.0.0.9" },
        })
      ).status,
    )
  expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
  expect(statuses[5]).toBe(429)
  expect(auth.hasOwner()).toBe(false)
})

test("login, session and forward_auth", async () => {
  const { auth, call } = setup()
  await auth.createOwner({
    name: "Ada",
    email: "ada@example.com",
    password: "correct horse battery",
  })
  expect(
    (await call("/api/auth/login", { ...json({ password: "nope" }), via: "local" })).status,
  ).toBe(401)
  const res = await call("/api/auth/login", {
    ...json({ password: "correct horse battery" }),
    via: "local",
  })
  expect(res.status).toBe(200)
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] as string
  expect(res.headers.get("set-cookie")).not.toContain("Secure")

  const ok = await call("/api/auth/check", {
    via: "local",
    headers: { cookie, "x-forwarded-uri": "/hermes/" },
  })
  expect(ok.status).toBe(200)
  expect(ok.headers.get("x-agentbox-user")).toBe("ada@example.com")

  const html = await call("/api/auth/check", {
    via: "lan",
    headers: { accept: "text/html", "x-forwarded-uri": "/browser/" },
  })
  expect(html.status).toBe(302)
  expect(html.headers.get("location")).toBe("/login/?next=%2Fbrowser%2F")
  expect((await call("/api/auth/check", { via: "lan" })).status).toBe(401)
  // forward_auth is only for Caddy.
  expect((await call("/api/auth/check", { headers: { cookie } })).status).toBe(403)
})

test("a spoofed iroh id is ignored without the proxy secret and unknown ids are rejected", async () => {
  const { auth, call } = setup()
  await auth.createOwner({
    name: "Ada",
    email: "ada@example.com",
    password: "correct horse battery",
  })
  // Direct request with an iroh header: treated as direct, no identity.
  const direct = await call("/api/rpc/auth/me", {
    headers: { "x-iroh-remote-id": "abc", "x-agentbox-via": "iroh" },
  })
  expect(direct.status).toBe(401)
  // Through the iroh listener with an unknown id.
  const unknown = await call("/api/auth/check", {
    via: "iroh",
    headers: { "x-iroh-remote-id": "unknown" },
  })
  expect(unknown.status).toBe(401)
})

test("pairing: a code pairs one iroh id once; revoke removes access", async () => {
  const { auth, devices, call } = setup()
  await auth.createOwner({
    name: "Ada",
    email: "ada@example.com",
    password: "correct horse battery",
  })
  await Bun.write(paths(config).irohEndpointId, "endpoint123\n")
  const win = await devices.pairStart("phone")
  expect(win.pwaLink).toContain("#iroh=endpoint123&pair=")
  expect(win.pwaLink).toContain("base=%2Fhermes")
  expect(await readFile(paths(config).irohEnv, "utf8")).toContain("IROH_ALLOW_PATHS=/\n")

  const redeem = (id: string, code: string) =>
    call("/api/devices/pair/redeem", {
      ...json({ code, name: "Pixel" }),
      via: "iroh",
      headers: { "x-iroh-remote-id": id },
    })
  expect((await redeem(PHONE1, "WRONGCODE")).status).toBe(401)
  expect((await redeem(PHONE1, win.code.toLowerCase())).status).toBe(200)
  expect((await redeem(PHONE2, win.code)).status).toBe(401)
  expect(await readFile(paths(config).irohEnv, "utf8")).toContain(`IROH_ALLOW_CLIENTS=${PHONE1}\n`)

  const check = await call("/api/auth/check", {
    via: "iroh",
    headers: { "x-iroh-remote-id": PHONE1 },
  })
  expect(check.status).toBe(200)
  expect(check.headers.get("x-agentbox-user")).toBe("ada@example.com")

  const [device] = devices.list()
  expect(await devices.revoke(device?.id as string)).toBe(true)
  expect(
    (await call("/api/auth/check", { via: "iroh", headers: { "x-iroh-remote-id": PHONE1 } }))
      .status,
  ).toBe(401)
  expect(await readFile(paths(config).irohEnv, "utf8")).toContain("IROH_ALLOW_PATHS=/__closed__")
  devices.stop()
})

test("direct requests must use a loopback Host; cross-origin mutations are rejected", async () => {
  const { call } = setup()
  expect((await call("/healthz", { headers: { host: "evil.example" } })).status).toBe(403)
  const res = await call("/api/auth/login", {
    ...json({ password: "x" }),
    via: "lan",
    headers: { origin: "https://evil.example" },
  })
  expect(res.status).toBe(403)
})

test("the CLI token works only on direct requests", async () => {
  const { call } = setup()
  const me = await call("/api/rpc/auth/me", {
    headers: { authorization: "Bearer cli-secret-token" },
  })
  expect(me.status).toBe(200)
  const viaEdge = await call("/api/rpc/auth/me", {
    via: "local",
    headers: { authorization: "Bearer cli-secret-token" },
  })
  expect(viaEdge.status).toBe(401)
})
