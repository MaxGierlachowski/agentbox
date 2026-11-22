import { existsSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { Device, PairingWindow } from "@workspace/contract"
import type { Db } from "@workspace/infra/db"
import { schema } from "@workspace/infra/db"
import { writeFileAtomic } from "@workspace/infra/fs"
import { and, eq, gt, isNull } from "drizzle-orm"
import { hashToken } from "../auth/auth"
import { type Config, paths } from "../config"
import { log } from "../log"

export const PAIR_TTL_MS = 10 * 60 * 1000
// No 0/O/1/I/L: codes are read off a screen and typed on a phone.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

export function pairingCode(length = 8) {
  const out: string[] = []
  const buf = new Uint8Array(1)
  const limit = 256 - (256 % CODE_ALPHABET.length)
  while (out.length < length) {
    crypto.getRandomValues(buf)
    const n = buf[0] as number
    if (n < limit) out.push(CODE_ALPHABET[n % CODE_ALPHABET.length] as string)
  }
  return out.join("")
}

const normalizeCode = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, "")

/**
 * The gateway's access file (IROH_CONFIG_FILE), re-read on SIGHUP. A systemd path unit reloads
 * agentbox-iroh whenever this file changes, so the service user never signals the gateway.
 *
 * - no devices, no window: nothing is reachable
 * - window open: everyone may connect; agentbox and Caddy only let unknown ids reach pairing
 * - otherwise: only paired endpoint ids
 */
export function renderAccess(irohIds: string[], windowOpen: boolean) {
  const lines = ["# Rendered by agentbox. Do not edit."]
  if (windowOpen) {
    lines.push("IROH_ALLOW_CLIENTS=", "IROH_ALLOW_PATHS=/")
  } else if (irohIds.length === 0) {
    lines.push("IROH_ALLOW_CLIENTS=", "IROH_ALLOW_PATHS=/__closed__")
  } else {
    lines.push(`IROH_ALLOW_CLIENTS=${irohIds.join(",")}`, "IROH_ALLOW_PATHS=/")
  }
  return `${lines.join("\n")}\n`
}

export class DeviceService {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  list(): Device[] {
    return this.db
      .select()
      .from(schema.devices)
      .where(isNull(schema.devices.revokedAt))
      .all()
      .filter((d) => d.kind !== "edge")
      .map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind as Device["kind"],
        irohId: d.irohId,
        createdAt: d.createdAt.toISOString(),
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      }))
  }

  endpointId(): string | null {
    const file = paths(this.config).irohEndpointId
    if (!existsSync(file)) return null
    const id = readFileSync(file, "utf8").trim()
    return id || null
  }

  async pairStart(kind: "phone" | "laptop" | "other"): Promise<PairingWindow> {
    const endpointId = this.endpointId()
    if (!endpointId)
      throw new Error("The iroh gateway is not online yet. Check `systemctl status agentbox-iroh`.")
    const code = pairingCode()
    const expiresAt = new Date(Date.now() + PAIR_TTL_MS)
    this.db
      .insert(schema.pairings)
      .values({ id: crypto.randomUUID(), codeHash: hashToken(code), kind, expiresAt })
      .run()
    await this.sync()
    const fragment = new URLSearchParams({
      iroh: endpointId,
      pair: code,
      base: "/hermes",
      ...(this.config.iroh.relayUrl ? { relay: this.config.iroh.relayUrl } : {}),
    })
    return {
      endpointId,
      code,
      expiresAt: expiresAt.toISOString(),
      pwaLink: `${this.config.pwaUrl.replace(/\/$/, "")}/#${fragment}`,
      connectCommand: `agentbox connect ${endpointId} --code ${code}`,
    }
  }

  /** Completes pairing for the iroh client that presented a valid code. */
  async redeem(code: string, irohId: string, name?: string) {
    const now = new Date()
    const window = this.db
      .update(schema.pairings)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.pairings.codeHash, hashToken(normalizeCode(code))),
          isNull(schema.pairings.usedAt),
          gt(schema.pairings.expiresAt, now),
        ),
      )
      .returning()
      .get()
    if (!window) return null
    const owner = this.db.select().from(schema.users).where(eq(schema.users.role, "owner")).get()
    if (!owner) return null
    const existing = this.db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.irohId, irohId))
      .get()
    const label = name?.trim() || (window.kind === "laptop" ? "Laptop" : "Phone")
    let id: string
    if (existing) {
      id = existing.id
      this.db
        .update(schema.devices)
        .set({ revokedAt: null, name: label, kind: window.kind, lastSeenAt: now })
        .where(eq(schema.devices.id, id))
        .run()
    } else {
      id = crypto.randomUUID()
      this.db
        .insert(schema.devices)
        .values({
          id,
          userId: owner.id,
          name: label,
          kind: window.kind,
          irohId,
          createdAt: now,
          lastSeenAt: now,
        })
        .run()
    }
    await this.sync()
    log.info({ device: id }, "device paired")
    return { id, name: label }
  }

  async revoke(id: string) {
    const row = this.db
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.devices.id, id), isNull(schema.devices.revokedAt)))
      .returning()
      .get()
    await this.sync()
    return Boolean(row)
  }

  /** Renders the gateway access file from the registry; schedules the re-render at window close. */
  async sync() {
    const now = new Date()
    const open = this.db
      .select()
      .from(schema.pairings)
      .where(and(isNull(schema.pairings.usedAt), gt(schema.pairings.expiresAt, now)))
      .all()
    const ids = this.db
      .select({ irohId: schema.devices.irohId })
      .from(schema.devices)
      .where(isNull(schema.devices.revokedAt))
      .all()
      .map((d) => d.irohId)
    const file = paths(this.config).irohEnv
    const next = renderAccess(ids, open.length > 0)
    const current = existsSync(file) ? readFileSync(file, "utf8") : null
    if (current !== next) {
      await mkdir(dirname(file), { recursive: true, mode: 0o750 })
      // 0640: the gateway runs as agentbox-edge (group member) and re-reads this on SIGHUP.
      await writeFileAtomic(file, next, 0o640)
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (open.length > 0) {
      const closesAt = Math.max(...open.map((w) => w.expiresAt.getTime()))
      this.timer = setTimeout(() => void this.sync(), closesAt - now.getTime() + 500)
    }
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
  }
}
