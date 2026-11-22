import { existsSync, readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir, hostname } from "node:os"
import { join } from "node:path"
import type { ServerWebSocket } from "bun"
import pc from "picocolors"
import { createIrohFetch } from "./iroh"

interface SavedBox {
  endpointId: string
  pairedAt: string
}

const configDir = () =>
  process.env.AGENTBOX_CONNECT_DIR ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "agentbox")

// Per-connection headers that must not be forwarded, plus the ones the tunnel sets itself.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "host",
  "content-length",
  "expect",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-accept",
])

function forwardHeaders(headers: Headers) {
  const out = new Headers()
  headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out.set(k, v)
  })
  // Already checked against this proxy's own origin; the box sees a different Host.
  out.delete("origin")
  out.delete("referer")
  return out
}

async function loadKey(dir: string) {
  const file = join(dir, "connect.key")
  if (existsSync(file)) return readFileSync(file, "utf8").trim()
  return null
}

function loadBoxes(dir: string): SavedBox[] {
  const file = join(dir, "boxes.json")
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, "utf8")) as SavedBox[]
}

/**
 * `agentbox connect`: pairs this laptop with a box once (persistent iroh identity), then serves
 * the box's whole origin (config UI, /hermes/, /browser/ incl. WebSockets) on localhost.
 * Uses iroh-fetch's native engine, so traffic goes direct (UDP hole punching) when possible.
 */
export async function connect(opts: {
  endpoint?: string
  code?: string
  port: number
  name?: string
}) {
  const dir = configDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const boxes = loadBoxes(dir)
  const endpointId = opts.endpoint ?? boxes.at(-1)?.endpointId
  if (!endpointId)
    throw new Error(
      "Which box? Run `agentbox connect <endpoint-id> --code <code>` from the box's Devices page first.",
    )

  const secretKey = await loadKey(dir)
  const iroh = await createIrohFetch({ endpointId, ...(secretKey ? { secretKey } : {}) })
  if (!secretKey)
    await writeFile(join(dir, "connect.key"), `${iroh.exportSecretKey()}\n`, { mode: 0o600 })

  if (opts.code) {
    process.stdout.write(`Pairing with ${endpointId.slice(0, 12)}… `)
    const res = await iroh.fetch("/api/devices/pair/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: opts.code, name: opts.name ?? hostname() }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(`pairing failed (${res.status}): ${body.error ?? "rejected"}`)
    }
    console.log(pc.green("paired"))
    const next = boxes.filter((b) => b.endpointId !== endpointId)
    next.push({ endpointId, pairedAt: new Date().toISOString() })
    await writeFile(join(dir, "boxes.json"), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  }

  type WsData = {
    path: string
    headers: Headers
    protocols: string[]
    remote?: WebSocket
    queue: (string | Buffer)[]
  }

  const server = Bun.serve<WsData>({
    hostname: "127.0.0.1",
    port: opts.port,
    idleTimeout: 0,
    async fetch(req, srv) {
      const url = new URL(req.url)
      const path = `${url.pathname}${url.search}`
      // DNS rebinding: only loopback names may use this proxy.
      const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "")
      if (!["localhost", "127.0.0.1", "[::1]"].includes(host) && !host.endsWith(".localhost"))
        return new Response("Forbidden host", { status: 403 })
      // Over iroh the device id is the credential, so other websites open in this browser must
      // not be able to use the proxy (CSRF): only pages served from this proxy may call it.
      const origin = req.headers.get("origin")
      if (origin && origin !== `http://${req.headers.get("host")}`)
        return new Response("Cross-origin request refused", { status: 403 })
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
        const ok = srv.upgrade(req, {
          data: { path, headers: forwardHeaders(req.headers), protocols, queue: [] },
          headers: protocols[0] ? { "Sec-WebSocket-Protocol": protocols[0] } : undefined,
        })
        return ok ? undefined : new Response("WebSocket upgrade failed", { status: 400 })
      }
      try {
        const res = await iroh.fetch(path, {
          method: req.method,
          headers: forwardHeaders(req.headers),
          body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
          redirect: "manual",
        })
        const headers = new Headers(res.headers)
        headers.delete("content-encoding")
        headers.delete("content-length")
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
      } catch (err) {
        return new Response(`Box not reachable over iroh: ${(err as Error).message}`, {
          status: 502,
        })
      }
    },
    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        const { path, headers, protocols } = ws.data
        const remote = iroh.websocket(path, { protocols, headers: Object.fromEntries(headers) })
        remote.binaryType = "arraybuffer"
        ws.data.remote = remote
        remote.onopen = () => {
          for (const m of ws.data.queue) remote.send(m)
          ws.data.queue = []
        }
        remote.onmessage = (e) =>
          ws.send(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer))
        remote.onclose = (e) => ws.close(e.code === 1005 ? 1000 : e.code, e.reason)
        remote.onerror = () => ws.close(1011, "upstream error")
      },
      message(ws, message) {
        const remote = ws.data.remote
        if (remote?.readyState === WebSocket.OPEN) remote.send(message)
        else ws.data.queue.push(message)
      },
      close(ws) {
        ws.data.remote?.close()
      },
    },
  })

  console.log(`\n  ${pc.green("✔")} Your box is on ${pc.bold(`http://localhost:${server.port}`)}`)
  console.log(
    pc.dim(`    Hermes UI: http://localhost:${server.port}/hermes/   ·   Ctrl-C to stop\n`),
  )
  const info = iroh.connectionInfo?.()
  if (info?.kind) console.log(pc.dim(`    path: ${info.kind}`))
  await new Promise(() => {})
}
