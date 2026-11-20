import { RPCHandler } from "@orpc/server/fetch"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { requestId } from "hono/request-id"
import { secureHeaders } from "hono/secure-headers"
import type { Config } from "../config"
import { log } from "../log"
import { type Auth, type Listener, SESSION_COOKIE, sessionMaxAgeSeconds } from "./auth"
import type { AppRouter } from "./router"
import { createStaticHandler } from "./static"

export type Env = { Bindings: { listener: Listener } }

export interface AppDeps {
  config: Config
  auth: Auth
  router: AppRouter
  /**
   * Directory with the Next.js export. Null in development, where `next dev` serves the UI and
   * rewrites /api and /auth to this server.
   */
  webRoot: string | null
}

export function createApp({ config, auth, router, webRoot }: AppDeps) {
  const app = new Hono<Env>()
  const rpc = new RPCHandler(router)
  const serveStatic = webRoot ? createStaticHandler(webRoot) : null

  app.use(requestId())
  app.use(
    secureHeaders({
      contentSecurityPolicy:
        config.mode === "production"
          ? {
              defaultSrc: ["'self'"],
              // TODO(P1): replace 'unsafe-inline' with build-time hashes of the export's inline scripts.
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:"],
              connectSrc: ["'self'"],
              frameAncestors: ["'none'"],
            }
          : undefined,
    }),
  )

  // DNS rebinding and CSRF protection: only known hosts, and same-origin mutations.
  app.use(async (c, next) => {
    // Nothing in agentbox is meant for Tailscale Funnel (public internet). Reject funnel traffic
    // before any identity header is looked at, in case someone turns Funnel on by mistake.
    if (c.env.listener === "tailscale" && c.req.header("tailscale-funnel-request")) {
      log.warn("rejected Tailscale Funnel request on the agentbox listener")
      return c.text("Not available", 404)
    }
    const host = c.req.header("host") ?? ""
    if (!isAllowedHost(host, c.env.listener, config)) {
      log.warn({ host, listener: c.env.listener }, "rejected request with unexpected Host header")
      return c.text("Forbidden host", 403)
    }
    // Mutations must come from one of our own origins. Compared against the allow list rather
    // than the Host header: in development `next dev` rewrites to this server, so the browser's
    // origin (localhost:3100) differs from the Host it forwards.
    const origin = c.req.header("origin")
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && origin) {
      const originHost = URL.canParse(origin) ? new URL(origin).host : ""
      if (!isAllowedHost(originHost, c.env.listener, config)) {
        return c.text("Cross-origin request rejected", 403)
      }
    }
    await next()
  })

  app.get("/healthz", (c) => c.text("ok"))

  app.get("/auth/link", (c) => {
    if (c.env.listener !== "local")
      return c.text("Login links only work on the local listener", 404)
    const token = c.req.query("token") ?? ""
    const session = auth.redeemLoginLink(token)
    if (!session) return c.text("This login link is invalid, expired or already used.", 401)
    setCookie(c, SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: sessionMaxAgeSeconds,
    })
    return c.redirect("/")
  })

  app.post("/auth/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) auth.revokeSession(token)
    deleteCookie(c, SESSION_COOKIE, { path: "/" })
    return c.json({ ok: true })
  })

  app.use("/api/rpc/*", bodyLimit({ maxSize: 1024 * 1024 }), async (c, next) => {
    const identity = auth.resolve(c.env.listener, c.req.raw.headers, getCookie(c, SESSION_COOKIE))
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: "/api/rpc",
      context: { identity },
    })
    if (matched) return response
    await next()
  })

  app.get("*", (c) =>
    serveStatic
      ? serveStatic(c.req.path)
      : c.text("UI is served by `next dev` on http://localhost:3100 in development.", 404),
  )

  return app
}

function isAllowedHost(host: string, listener: Listener, config: Config) {
  if (listener === "tailscale") return /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net(:\d+)?$/i.test(host)
  const ports = [String(config.port)]
  if (config.mode === "development") ports.push("3100")
  return ports.some((p) => host === `127.0.0.1:${p}` || host === `localhost:${p}`)
}
