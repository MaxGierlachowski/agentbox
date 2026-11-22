import { hostname } from "node:os"
import type { Check, ServiceStatus, SystemInfo } from "@workspace/contract"
import pkg from "../../package.json" with { type: "json" }
import type { Config } from "../config"
import { exec } from "../exec"

interface UnitSpec {
  id: string
  unit: string
  label: string
  /** Loopback health URL; ok when it answers 2xx (or any status if `anyStatus`). */
  health?: string
  anyStatus?: boolean
}

export const UNITS: UnitSpec[] = [
  {
    id: "config",
    unit: "agentbox-config.service",
    label: "agentbox",
    health: "http://127.0.0.1:7777/healthz",
  },
  {
    id: "caddy",
    unit: "agentbox-caddy.service",
    label: "Edge proxy (Caddy)",
    health: "http://127.0.0.1:8080/healthz",
  },
  {
    id: "iroh",
    unit: "agentbox-iroh.service",
    label: "iroh gateway",
    health: "http://127.0.0.1:8090/healthz",
    anyStatus: true,
  },
  { id: "hermes", unit: "agentbox-hermes.service", label: "Hermes agent" },
  {
    id: "hermes-ui",
    unit: "agentbox-hermes-ui.service",
    label: "Hermes UI",
    health: "http://127.0.0.1:8787/api/health",
  },
  {
    id: "paseo",
    unit: "agentbox-paseo.service",
    label: "Paseo",
    health: "http://127.0.0.1:6767/api/health",
  },
  {
    id: "kasmvnc",
    unit: "agentbox-kasmvnc.service",
    label: "Browser stream (KasmVNC)",
    health: "http://127.0.0.1:6901/",
    anyStatus: true,
  },
  {
    id: "chrome",
    unit: "agentbox-chrome.service",
    label: "Chrome",
    health: "http://127.0.0.1:9333/json/version",
  },
]

async function probe(url: string, anyStatus = false) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    return anyStatus || res.ok
      ? { ok: true, status: res.status }
      : { ok: false, status: res.status }
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message }
  }
}

export class SystemService {
  constructor(
    private readonly config: Config,
    private readonly startedAt: Date,
  ) {}

  info(): SystemInfo {
    return {
      version: pkg.version,
      hostname: hostname(),
      platform: process.platform,
      arch: process.arch,
      startedAt: this.startedAt.toISOString(),
      listen: this.config.listen,
      lanUrl: this.config.lanUrl,
      certFingerprint: this.config.certFingerprint,
      pwaUrl: this.config.pwaUrl,
    }
  }

  async services(): Promise<ServiceStatus[]> {
    return Promise.all(
      UNITS.map(async (u) => {
        const r = await exec(["systemctl", "is-active", u.unit], { timeoutMs: 5000 })
        const active = r.stdout.trim() === "active"
        const h = u.health ? await probe(u.health, u.anyStatus) : { ok: active, status: 0 }
        return {
          id: u.id,
          unit: u.unit,
          label: u.label,
          active,
          healthy: active && h.ok,
          message: !active
            ? r.stdout.trim() || "inactive"
            : h.ok
              ? "healthy"
              : `health check failed (${h.status})`,
        }
      }),
    )
  }

  async doctor(): Promise<{ checks: Check[] }> {
    const checks: Check[] = []
    for (const s of await this.services())
      checks.push({
        id: `service.${s.id}`,
        level: s.healthy ? "ok" : s.active ? "warn" : "fail",
        message: `${s.label}: ${s.message}`,
      })
    // Only Caddy's LAN listener may face the network.
    const ss = await exec(["ss", "-tulnH"], { timeoutMs: 5000 })
    const exposed = ss.stdout
      .split("\n")
      .map((l) => l.trim().split(/\s+/)[4])
      .filter((addr): addr is string => Boolean(addr))
      .filter((addr) => !/^(127\.0\.0\.\d+|\[::1\]|\[::ffff:127\.0\.0\.1\]):/.test(addr))
      .filter((addr) => !(this.config.listen === "lan" && addr.endsWith(":8443")))
      .filter((addr) => !addr.endsWith(":22"))
    checks.push({
      id: "network.exposure",
      level: exposed.length ? "fail" : "ok",
      message: exposed.length
        ? `Unexpected listeners: ${exposed.join(", ")}`
        : "Only expected ports face the network",
    })
    checks.push({
      id: "runtime",
      level: "ok",
      message: `agentbox ${pkg.version}, Bun ${Bun.version} on ${process.platform}/${process.arch}`,
    })
    return { checks }
  }
}
