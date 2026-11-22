/**
 * In-memory fake of the agentbox server for UI development and Playwright tests.
 *
 *   bun run --cwd e2e mock                     # 127.0.0.1:7799, fresh box (unclaimed)
 *   MOCK_PRESET=onboarded bun run --cwd e2e mock
 *   AGENTBOX_API=http://127.0.0.1:7799 bun run --cwd apps/web dev
 *
 * Implements the full oRPC contract plus the plain cookie routes. Test helpers live under
 * `/__mock/*` (reset, simulate a device redeeming a pairing code).
 */
import { RPCHandler } from "@orpc/server/fetch"
import { createRouter } from "./router"
import {
  CLAIM_OTP,
  createState,
  DEMO_PASSWORD,
  type MockState,
  type Preset,
  RESET_OTP,
} from "./state"

const PORT = Number(process.env.MOCK_PORT ?? 7799)
const COOKIE = "agentbox_session"

let state: MockState = createState((process.env.MOCK_PRESET as Preset) ?? "fresh")
const rpc = new RPCHandler(createRouter(() => state))

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers })

const readCookie = (req: Request) =>
  req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1) ?? null

function newSession(remember?: boolean) {
  const token = crypto.randomUUID()
  state.sessions.add(token)
  const maxAge = remember ? 30 * 86400 : 12 * 3600
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "")

function page(title: string, content: string) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#f5f5f4;color:#1c1917}
.bar{display:flex;gap:6px;align-items:center;padding:8px 12px;background:#e7e5e4;border-bottom:1px solid #d6d3d1}
.dot{width:10px;height:10px;border-radius:50%;background:#a8a29e}.url{flex:1;margin-left:8px;background:#fff;border-radius:6px;padding:4px 10px;color:#57534e;font-size:12px}
main{padding:32px;max-width:640px;margin:auto}code{background:#e7e5e4;padding:2px 6px;border-radius:4px}</style></head>
<body>${content}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  )
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // ---- test helpers ----
    if (path === "/__mock/reset" && req.method === "POST") {
      const b = await body(req)
      state = createState((str(b.preset) as Preset) || "fresh")
      return json({ ok: true })
    }
    if (path === "/__mock/state") return json({ ...state, sessions: state.sessions.size })
    if (path === "/__mock/pair" && req.method === "POST") {
      if (!state.pairing) return json({ error: "no pairing window" }, 409)
      const b = await body(req)
      state.devices.push({
        id: `dev_${crypto.randomUUID().slice(0, 8)}`,
        name: str(b.name) || "Phone",
        kind: "phone",
        irohId: crypto.randomUUID().replaceAll("-", "").repeat(2),
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      })
      state.pairing = null
      return json({ ok: true })
    }

    // ---- plain cookie routes ----
    if (path === "/api/setup/status") return json({ claimed: state.claimed })
    if (path === "/api/setup/claim" && req.method === "POST") {
      if (state.claimed) return json({ error: "not found" }, 404)
      const b = await body(req)
      const name = str(b.name).trim()
      const email = str(b.email).trim()
      const password = str(b.password)
      if (!name || !email.includes("@") || password.length < 12)
        return json({ error: "Check the form fields." }, 400)
      if (str(b.otp).trim().toLowerCase().replaceAll(" ", "-") !== CLAIM_OTP)
        return json(
          {
            error:
              "This one-time code is wrong, used or expired. Run `sudo agentbox otp` for a new one.",
          },
          401,
        )
      state.claimed = true
      state.owner = { name, email, password }
      return json({ ok: true }, 200, { "set-cookie": newSession(Boolean(b.remember)) })
    }
    if (path === "/api/auth/login" && req.method === "POST") {
      const b = await body(req)
      if (!state.owner)
        return json(
          { error: "This box is not claimed yet. Open the setup link from the console." },
          409,
        )
      if (str(b.password) !== state.owner.password) return json({ error: "Wrong password" }, 401)
      return json({ ok: true }, 200, { "set-cookie": newSession(Boolean(b.remember)) })
    }
    if (path === "/api/auth/reset" && req.method === "POST") {
      const b = await body(req)
      if (str(b.password).length < 12)
        return json({ error: "Code and a password of 12+ characters required" }, 400)
      if (str(b.otp).trim().toLowerCase().replaceAll(" ", "-") !== RESET_OTP || !state.owner)
        return json({ error: "Wrong or expired code" }, 401)
      state.owner.password = str(b.password)
      return json({ ok: true })
    }
    if (path === "/auth/logout" && req.method === "POST") {
      const token = readCookie(req)
      if (token) state.sessions.delete(token)
      return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; Max-Age=0` })
    }

    // ---- oRPC ----
    if (path.startsWith("/api/rpc")) {
      const { matched, response } = await rpc.handle(req, {
        prefix: "/api/rpc",
        context: { session: readCookie(req) },
      })
      if (matched) return response
    }
    if (path.startsWith("/api/")) return json({ error: "not found" }, 404)

    // ---- stand-ins for the apps that share the origin ----
    if (path.startsWith("/hermes")) {
      const compose = url.searchParams.get("compose") ?? ""
      return page(
        "Hermes UI (mock)",
        `<main><h1>Hermes UI</h1><p>Mock stand-in. Composer prefilled with:</p>
<p data-testid="compose"><code>${Bun.escapeHTML(compose) || "(empty)"}</code></p></main>`,
      )
    }
    if (path.startsWith("/browser")) {
      return page(
        "Browser (mock)",
        `<div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
<span class="url">https://github.com/login</span></div>
<main><h2>Sign in to GitHub</h2><p>This is a stand-in for the box's Chrome, streamed through KasmVNC at <code>/browser/</code>.</p></main>`,
      )
    }
    return new Response("Not found", { status: 404 })
  },
})

console.log(`agentbox mock server on http://${server.hostname}:${server.port}`)
console.log(`  preset: ${process.env.MOCK_PRESET ?? "fresh"}`)
console.log(`  claim:  http://localhost:3100/setup/#otp=${CLAIM_OTP}`)
console.log(`  reset:  ${RESET_OTP}  ·  password for claimed presets: ${DEMO_PASSWORD}`)
