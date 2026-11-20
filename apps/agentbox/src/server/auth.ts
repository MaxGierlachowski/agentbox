import { timingSafeEqual } from "node:crypto"
import { sha256 } from "@oslojs/crypto/sha2"
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from "@oslojs/encoding"
import type { Identity } from "@workspace/contract"
import type { Db } from "@workspace/infra/db"
import { schema } from "@workspace/infra/db"
import { and, eq, gt, isNull } from "drizzle-orm"
import type { Config } from "../config"

export type Listener = "tailscale" | "local"

export const SESSION_COOKIE = "agentbox_session"
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const LINK_TTL_MS = 5 * 60 * 1000

export function randomToken(bytes = 32) {
  return encodeBase32LowerCaseNoPadding(crypto.getRandomValues(new Uint8Array(bytes)))
}

const hashToken = (token: string) => encodeHexLowerCase(sha256(new TextEncoder().encode(token)))

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export class Auth {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly cliToken: string,
  ) {}

  /**
   * Resolves who is calling. Identity headers are only trusted on the Tailscale socket:
   * `tailscale serve` strips client-supplied copies, and only root and the agentbox user can
   * connect to that socket. On the local listener they are ignored.
   */
  resolve(listener: Listener, headers: Headers, sessionToken: string | undefined): Identity | null {
    if (listener === "tailscale") {
      const login = headers.get("tailscale-user-login")
      if (!login || !this.config.allowedUsers.includes(login)) return null
      return { login, name: headers.get("tailscale-user-name"), via: "tailscale" }
    }

    const bearer = headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]
    if (bearer && safeEqual(bearer, this.cliToken)) return { login: "cli", name: null, via: "cli" }

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
        this.touch(session.id)
        return { login: session.login, name: null, via: "session" }
      }
    }

    if (this.config.devIdentity)
      return { login: this.config.devIdentity, name: "Developer", via: "session" }
    return null
  }

  /** Creates a single-use login link token (stored hashed). */
  createLoginLink(login: string) {
    const token = randomToken()
    this.db
      .insert(schema.loginLinks)
      .values({ id: hashToken(token), login, expiresAt: new Date(Date.now() + LINK_TTL_MS) })
      .run()
    return token
  }

  /** Redeems a login link and returns a new session token, or null if invalid/expired/used. */
  redeemLoginLink(token: string): string | null {
    const id = hashToken(token)
    const now = new Date()
    const link = this.db
      .update(schema.loginLinks)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.loginLinks.id, id),
          isNull(schema.loginLinks.usedAt),
          gt(schema.loginLinks.expiresAt, now),
        ),
      )
      .returning()
      .get()
    if (!link) return null
    const sessionToken = randomToken()
    this.db
      .insert(schema.sessions)
      .values({
        id: hashToken(sessionToken),
        login: link.login,
        createdAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      })
      .run()
    return sessionToken
  }

  revokeSession(sessionToken: string) {
    this.db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, hashToken(sessionToken)))
      .run()
  }

  /** Sliding expiry. */
  private touch(id: string) {
    this.db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(schema.sessions.id, id))
      .run()
  }
}

export const sessionMaxAgeSeconds = SESSION_TTL_MS / 1000
