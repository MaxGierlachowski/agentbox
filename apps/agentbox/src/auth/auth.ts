import { timingSafeEqual } from "node:crypto"
import { sha256 } from "@oslojs/crypto/sha2"
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from "@oslojs/encoding"
import type { Identity } from "@workspace/contract"
import type { Db } from "@workspace/infra/db"
import { schema } from "@workspace/infra/db"
import { and, eq, gt, isNull } from "drizzle-orm"
import type { Config } from "../config"
import { generateOtp, hashOtp } from "./otp"

/**
 * How a request reached the API:
 * - `direct`: straight to 127.0.0.1:7777 (CLI, health checks). Only the CLI token or a session
 *   cookie counts; edge headers are ignored.
 * - `local` | `lan` | `iroh`: through Caddy, proven by the shared proxy secret. Only on `iroh` is
 *   `X-Iroh-Remote-Id` trusted (Caddy strips it on the other listeners, and only iroh-gateway's
 *   uid may connect to Caddy's iroh listener).
 */
export type Via = "direct" | "local" | "lan" | "iroh"

export const SESSION_COOKIE = "agentbox_session"
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const OTP_TTL_MS = 60 * 60 * 1000
const LINK_TTL_MS = 5 * 60 * 1000

export function randomToken(bytes = 32) {
  return encodeBase32LowerCaseNoPadding(crypto.getRandomValues(new Uint8Array(bytes)))
}

export const hashToken = (token: string) =>
  encodeHexLowerCase(sha256(new TextEncoder().encode(token)))

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export interface RequestFacts {
  via: Via
  headers: Headers
  sessionToken: string | undefined
}

/** Reads the edge headers; falls back to `direct` unless the proxy secret matches. */
export function edgeVia(headers: Headers, proxySecret: string | null): Via {
  const secret = headers.get("x-agentbox-proxy-secret")
  if (!proxySecret || !secret || !safeEqual(secret, proxySecret)) return "direct"
  const via = headers.get("x-agentbox-via")
  return via === "lan" || via === "iroh" ? via : "local"
}

export class Auth {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly cliToken: string,
  ) {}

  owner() {
    return this.db.select().from(schema.users).where(eq(schema.users.role, "owner")).get() ?? null
  }

  hasOwner() {
    return this.owner() !== null
  }

  resolve({ via, headers, sessionToken }: RequestFacts): Identity | null {
    if (via === "direct") {
      const bearer = headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]
      if (bearer && safeEqual(bearer, this.cliToken))
        return { login: "cli", name: null, via: "cli" }
    }
    if (via === "iroh") {
      // Over iroh only the paired device counts, never a cookie.
      const device = this.deviceFor(headers.get("x-iroh-remote-id"))
      if (!device) return null
      const owner = this.owner()
      return owner ? { login: owner.email, name: owner.name, via: "device" } : null
    }
    if (sessionToken) {
      const session = this.db
        .select()
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.id, hashToken(sessionToken)),
            gt(schema.sessions.expiresAt, new Date()),
          ),
        )
        .get()
      if (session) {
        this.touch(session.id, session.expiresAt.getTime() - session.createdAt.getTime())
        const owner = this.owner()
        return { login: session.login, name: owner?.name ?? null, via: "session" }
      }
    }
    if (this.config.devIdentity)
      return { login: this.config.devIdentity, name: "Developer", via: "session" }
    return null
  }

  deviceFor(irohId: string | null) {
    if (!irohId) return null
    const device = this.db
      .select()
      .from(schema.devices)
      .where(and(eq(schema.devices.irohId, irohId), isNull(schema.devices.revokedAt)))
      .get()
    if (!device) return null
    const now = new Date()
    // Coarse last-seen: at most one write per minute per device.
    if (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > 60_000)
      this.db
        .update(schema.devices)
        .set({ lastSeenAt: now })
        .where(eq(schema.devices.id, device.id))
        .run()
    return device
  }

  // ---- one-time passwords -------------------------------------------------------------------

  /** Issues a new OTP; earlier unused ones of the same purpose stop working. */
  issueOtp(purpose: "claim" | "reset") {
    const otp = generateOtp()
    const now = new Date()
    this.db
      .update(schema.otps)
      .set({ usedAt: now })
      .where(and(eq(schema.otps.purpose, purpose), isNull(schema.otps.usedAt)))
      .run()
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS)
    this.db
      .insert(schema.otps)
      .values({ id: crypto.randomUUID(), hash: hashOtp(otp), purpose, expiresAt })
      .run()
    return { otp, expiresAt }
  }

  /** Burns a matching OTP. Returns false if wrong, used or expired. */
  redeemOtp(otp: string, purpose: "claim" | "reset") {
    const now = new Date()
    const row = this.db
      .update(schema.otps)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.otps.hash, hashOtp(otp)),
          eq(schema.otps.purpose, purpose),
          isNull(schema.otps.usedAt),
          gt(schema.otps.expiresAt, now),
        ),
      )
      .returning()
      .get()
    return Boolean(row)
  }

  /** Checks an OTP without burning it (claim validates everything else first). */
  otpValid(otp: string, purpose: "claim" | "reset") {
    const row = this.db
      .select()
      .from(schema.otps)
      .where(
        and(
          eq(schema.otps.hash, hashOtp(otp)),
          eq(schema.otps.purpose, purpose),
          isNull(schema.otps.usedAt),
          gt(schema.otps.expiresAt, new Date()),
        ),
      )
      .get()
    return Boolean(row)
  }

  // ---- owner --------------------------------------------------------------------------------

  async createOwner(input: { name: string; email: string; password: string }) {
    if (this.hasOwner()) throw new Error("This box already has an owner")
    const passwordHash = await Bun.password.hash(input.password, { algorithm: "argon2id" })
    const id = crypto.randomUUID()
    this.db
      .insert(schema.users)
      .values({
        id,
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash,
        role: "owner",
        createdAt: new Date(),
      })
      .run()
    return id
  }

  async verifyPassword(password: string) {
    const owner = this.owner()
    if (!owner) return false
    return Bun.password.verify(password, owner.passwordHash)
  }

  async setPassword(password: string) {
    const owner = this.owner()
    if (!owner) throw new Error("No owner yet")
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" })
    this.db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, owner.id)).run()
    // A new password signs out every other session.
    this.db.delete(schema.sessions).run()
  }

  // ---- sessions -----------------------------------------------------------------------------

  createSession(login: string, remember = false) {
    const token = randomToken()
    const now = new Date()
    const ttl = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS
    this.db
      .insert(schema.sessions)
      .values({
        id: hashToken(token),
        login,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ttl),
      })
      .run()
    return { token, maxAgeSeconds: ttl / 1000 }
  }

  revokeSession(sessionToken: string) {
    this.db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, hashToken(sessionToken)))
      .run()
  }

  /** Sliding expiry, keeping the session's original length (12 h or 30 d). */
  private touch(id: string, ttl: number) {
    this.db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + Math.max(ttl, SESSION_TTL_MS)) })
      .where(eq(schema.sessions.id, id))
      .run()
  }

  /** One-time login link for the SSH-tunnel path (`agentbox login-link`). */
  createLoginLink(login: string) {
    const token = randomToken()
    this.db
      .insert(schema.loginLinks)
      .values({ id: hashToken(token), login, expiresAt: new Date(Date.now() + LINK_TTL_MS) })
      .run()
    return token
  }

  redeemLoginLink(token: string) {
    const now = new Date()
    const link = this.db
      .update(schema.loginLinks)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.loginLinks.id, hashToken(token)),
          isNull(schema.loginLinks.usedAt),
          gt(schema.loginLinks.expiresAt, now),
        ),
      )
      .returning()
      .get()
    return link ? this.createSession(link.login) : null
  }
}

/** Fixed-window limiter: `max` attempts per key per `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; since: number }>()
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt; false when the key is over the limit. */
  attempt(key: string) {
    const now = Date.now()
    const h = this.hits.get(key)
    if (!h || now - h.since > this.windowMs) {
      this.hits.set(key, { count: 1, since: now })
      return true
    }
    h.count++
    return h.count <= this.max
  }
}
