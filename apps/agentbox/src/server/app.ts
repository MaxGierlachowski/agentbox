import { RPCHandler } from "@orpc/server/fetch"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { requestId } from "hono/request-id"
import { secureHeaders } from "hono/secure-headers"
import { z } from "zod"
import { type Auth, edgeVia, RateLimiter, SESSION_COOKIE, type Via } from "../auth/auth"
import type { Config } from "../config"
import type { DeviceService } from "../devices/service"
import { log } from "../log"
import type { AppRouter } from "./router"
import { createStaticHandler } from "./static"

export type Env = { Variables: { via: Via } }

export interface AppDeps {
  config: Config
  auth: Auth
  router: AppRouter
  devices: DeviceService
  /** Reads the Caddy proxy secret (null until `agentbox up` wrote it). */
  proxySecret: () => string | null
  /**
   * Directory with the Next.js export. Null in development, where `next dev` serves the UI and
   * rewrites /api and /auth to this server.
   */
  webRoot: string | null
}

const Claim = z.object({
  otp: z.string().min(3).max(200),
  name: z.string().trim().min(1).max(100),
  email: z.email().max(200),
  password: z.string().min(12).max(1000),
  remember: z.boolean().optional(),
})
const Login = z.object({ password: z.string().min(1).max(1000), remember: z.boolean().optional() })
const Reset = z.object({ otp: z.string().min(3).max(200), password: z.string().min(12).max(1000) })
const Redeem = z.object({ code: z.string().min(4).max(64), name: z.string().max(100).optional() })

/** Paths an unpaired iroh client may reach while a pairing window is open. */
const PAIR_PATHS = ["/api/devices/pair/redeem", "/hermes/api/pair/redeem"]

export function createApp({ config, auth, router, devices, proxySecret, webRoot }: AppDeps) {
  const app = new Hono<Env>()
  const rpc = new RPCHandler(router)
  const serveStatic = webRoot ? createStaticHandler(webRoot) : null
  // 5 attempts per minute per client for OTP, password and pairing codes.
  const limiter = new RateLimiter(5, 60_000)

  const clientKey = (headers: Headers, via: Via) =>
    via === "iroh"
      ? `iroh:${headers.get("x-iroh-remote-id")}`
      : (headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "direct")

  const sessionCookie = (via: Via, token: string, maxAge: number) => ({
    httpOnly: true,
    sameSite: "Strict" as const,
    path: "/",
    // The LAN listener is HTTPS; local (SSH tunnel / agentbox connect) is plain http://localhost.
    secure: via === "lan",
    maxAge,
    value: token,
  })

  app.use(requestId())
  app.use(
    secureHeaders({
      contentSecurityPolicy:
        config.mode === "production"
          ? {
              defaultSrc: ["'self'"],
              // TODO: replace 'unsafe-inline' with build-time hashes of the export's inline scripts.
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:"],
              connectSrc: ["'self'"],
              // The onboarding embeds the streamed browser (/browser/) from the same origin.
              frameSrc: ["'self'"],
              frameAncestors: ["'self'"],
            }
          : undefined,
      xFrameOptions: "SAMEORIGIN",
    }),
  )

  // Edge trust, DNS rebinding and CSRF protection.
  app.use(async (c, next) => {
    const via = edgeVia(c.req.raw.headers, proxySecret())
    c.set("via", via)
    const host = c.req.header("host") ?? ""
    // Direct requests must address the loopback listener. Through Caddy the Host is the LAN IP,
    // localhost:8080 or whatever the iroh client sends; Caddy already matched the site.
    if (via === "direct" && !isLoopbackHost(host, config)) {
      log.warn({ host }, "rejected direct request with unexpected Host header")
      return c.text("Forbidden host", 403)
    }
    const origin = c.req.header("origin")
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && origin) {
      const originHost = URL.canParse(origin) ? new URL(origin).host : ""
      const devOk =
        config.mode === "development" && /^(localhost|127\.0\.0\.1):3100$/.test(originHost)
      if (originHost !== host && !devOk) return c.text("Cross-origin request rejected", 403)
    }
    await next()
  })

  app.get("/healthz", (c) => c.text("ok"))

  // ---- claim & login (cookies) -------------------------------------------------------------

  app.get("/api/setup/status", (c) => c.json({ claimed: auth.hasOwner() }))

  app.post("/api/setup/claim", bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    if (auth.hasOwner()) return c.json({ error: "not found" }, 404)
    if (c.get("via") === "iroh")
      return c.json({ error: "Claim the box on the LAN or SSH URL" }, 403)
    if (!limiter.attempt(`otp:${clientKey(c.req.raw.headers, c.get("via"))}`))
      return c.json({ error: "Too many attempts. Wait a minute." }, 429)
    const parsed = Claim.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return c.json({ error: "Check the form fields.", issues: parsed.error.issues }, 400)
    const { otp, name, email, password, remember } = parsed.data
    if (!auth.otpValid(otp, "claim"))
      return c.json(
        {
          error:
            "This one-time code is wrong, used or expired. Run `sudo agentbox otp` for a new one.",
        },
        401,
      )
    if (!auth.redeemOtp(otp, "claim")) return c.json({ error: "Code already used" }, 401)
    await auth.createOwner({ name, email, password })
    const session = auth.createSession(email.toLowerCase(), remember)
    const { value, ...opts } = sessionCookie(c.get("via"), session.token, session.maxAgeSeconds)
    setCookie(c, SESSION_COOKIE, value, opts)
    log.info({ via: c.get("via") }, "box claimed")
    return c.json({ ok: true })
  })

  app.post("/api/auth/login", bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
    if (!limiter.attempt(`pw:${clientKey(c.req.raw.headers, c.get("via"))}`))
      return c.json({ error: "Too many attempts. Wait a minute." }, 429)
    const parsed = Login.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: "Password required" }, 400)
    const owner = auth.owner()
    if (!owner)
      return c.json(
        { error: "This box is not claimed yet. Open the setup link from the console." },
        409,
      )
    if (!(await auth.verifyPassword(parsed.data.password)))
      return c.json({ error: "Wrong password" }, 401)
    const session = auth.createSession(owner.email, parsed.data.remember)
    const { value, ...opts } = sessionCookie(c.get("via"), session.token, session.maxAgeSeconds)
    setCookie(c, SESSION_COOKIE, value, opts)
    return c.json({ ok: true })
  })

  // `sudo agentbox reset-owner` issues a reset code; it only allows setting a new password.
  app.post("/api/auth/reset", bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
    if (!limiter.attempt(`otp:${clientKey(c.req.raw.headers, c.get("via"))}`))
      return c.json({ error: "Too many attempts. Wait a minute." }, 429)
    const parsed = Reset.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return c.json({ error: "Code and a password of 12+ characters required" }, 400)
    if (!auth.redeemOtp(parsed.data.otp, "reset"))
      return c.json({ error: "Wrong or expired code" }, 401)
    await auth.setPassword(parsed.data.password)
    return c.json({ ok: true })
  })

  app.post("/auth/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) auth.revokeSession(token)
    deleteCookie(c, SESSION_COOKIE, { path: "/" })
    return c.json({ ok: true })
  })

  app.get("/auth/link", (c) => {
    if (c.get("via") === "iroh" || c.get("via") === "lan")
      return c.text("Login links only work through the SSH tunnel", 404)
    const session = auth.redeemLoginLink(c.req.query("token") ?? "")
    if (!session) return c.text("This login link is invalid, expired or already used.", 401)
    const { value, ...opts } = sessionCookie(c.get("via"), session.token, session.maxAgeSeconds)
    setCookie(c, SESSION_COOKIE, value, opts)
    return c.redirect("/")
  })

  // ---- Caddy forward_auth for /hermes/* and /browser/* ------------------------------------

  app.get("/api/auth/check", (c) => {
    const via = c.get("via")
    if (via === "direct") return c.text("forward_auth only", 403)
    const uri = c.req.header("x-forwarded-uri") ?? "/"
    const identity = auth.resolve({
      via,
      headers: c.req.raw.headers,
      sessionToken: getCookie(c, SESSION_COOKIE),
    })
    if (identity) {
      c.header("X-Agentbox-User", identity.login)
      return c.body(null, 200)
    }
    const accept = c.req.header("accept") ?? ""
    if (via !== "iroh" && accept.includes("text/html"))
      return c.redirect(`/login/?next=${encodeURIComponent(uri)}`, 302)
    return c.json({ error: "unauthorized" }, 401)
  })

  // ---- device pairing over iroh ----------------------------------------------------------

  app.post("/api/devices/pair/redeem", bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
    const via = c.get("via")
    const irohId = c.req.header("x-iroh-remote-id")
    if (via !== "iroh" || !irohId) return c.json({ error: "Pairing works only over iroh" }, 400)
    if (!limiter.attempt(`pair:${irohId}`)) return c.json({ error: "Too many attempts" }, 429)
    const parsed = Redeem.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: "code required" }, 400)
    const device = await devices.redeem(parsed.data.code, irohId, parsed.data.name)
    if (!device) return c.json({ error: "Pairing code invalid or expired" }, 401)
    return c.json({ ok: true, device: { id: device.id, name: device.name } })
  })

  // ---- oRPC ------------------------------------------------------------------------------

  app.use("/api/rpc/*", bodyLimit({ maxSize: 1024 * 1024 }), async (c, next) => {
    const via = c.get("via")
    const identity = auth.resolve({
      via,
      headers: c.req.raw.headers,
      sessionToken: getCookie(c, SESSION_COOKIE),
    })
    // An unpaired iroh client never reaches procedures (the gateway only admits pairing paths
    // while a window is open; this is the second line of defence).
    if (via === "iroh" && !identity) return c.json({ error: "unauthorized" }, 401)
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: "/api/rpc",
      context: { identity, via },
    })
    if (matched) return response
    await next()
  })

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404))

  // ---- static UI -------------------------------------------------------------------------

  app.get("*", (c) => {
    if (
      c.get("via") === "iroh" &&
      !auth.resolve({ via: "iroh", headers: c.req.raw.headers, sessionToken: undefined })
    ) {
      // Unpaired iroh clients see nothing but the pairing endpoint.
      if (!PAIR_PATHS.includes(c.req.path)) return c.text("Not paired", 401)
    }
    // After the claim, /setup is gone for good.
    if (c.req.path.startsWith("/setup") && auth.hasOwner()) return c.text("Not found", 404)
    return serveStatic
      ? serveStatic(c.req.path)
      : c.text("UI is served by `next dev` on http://localhost:3100 in development.", 404)
  })

  return app
}

function isLoopbackHost(host: string, config: Config) {
  const ports = [String(config.port)]
  if (config.mode === "development") ports.push("3100")
  return ports.some((p) => host === `127.0.0.1:${p}` || host === `localhost:${p}`)
}
