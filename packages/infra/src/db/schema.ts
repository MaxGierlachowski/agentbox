import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    workspace: text("workspace").notNull(),
    kind: text("kind", { enum: ["plan", "apply", "verify"] }).notNull(),
    title: text("title").notNull().default(""),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "failed", "cancelled"],
    }).notNull(),
    actor: text("actor").notNull(),
    planHash: text("plan_hash"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [index("runs_started_at_idx").on(t.startedAt)],
)

/** Append-only event log per run. `seq` is the SSE event id used to resume streams. */
export const runEvents = sqliteTable(
  "run_events",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    at: text("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
)

export const sessions = sqliteTable("sessions", {
  /** SHA-256 of the session token; the token itself only lives in the cookie. */
  id: text("id").primaryKey(),
  login: text("login").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

/** The box owner (v1 has exactly one user). `orgId` is the hook for later org sharing. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  /** argon2id hash. */
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["owner"] }).notNull(),
  orgId: text("org_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

/** One-time passwords printed on the console: claiming the box, or resetting the owner password. */
export const otps = sqliteTable("otps", {
  id: text("id").primaryKey(),
  /** SHA-256 of the normalized words. */
  hash: text("hash").notNull(),
  purpose: text("purpose", { enum: ["claim", "reset"] }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
})

/** Paired iroh clients (phones, laptops). Rendered into the gateway's allow list. */
export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["phone", "laptop", "other", "edge"] }).notNull(),
  irohId: text("iroh_id").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
})

/** Open pairing windows: single-use code, stored hashed. */
export const pairings = sqliteTable("pairings", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull(),
  kind: text("kind", { enum: ["phone", "laptop", "other"] }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
})

/** Small JSON documents: onboarding state, settings, catalog cache entries. */
export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull(),
})

/** One-time login links for browser access through an SSH tunnel. */
export const loginLinks = sqliteTable("login_links", {
  id: text("id").primaryKey(),
  login: text("login").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
})

/** Provider state (fingerprints, outputs) scoped by workspace and provider. */
export const providerState = sqliteTable(
  "provider_state",
  {
    workspace: text("workspace").notNull(),
    provider: text("provider").notNull(),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.provider, t.key] })],
)

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: text("at").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: text("detail", { mode: "json" }),
})
