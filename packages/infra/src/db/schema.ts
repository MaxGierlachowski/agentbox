import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    workspace: text("workspace").notNull(),
    kind: text("kind", { enum: ["plan", "apply", "verify"] }).notNull(),
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

/** Plane work items handled by the Plane -> CloudCLI automation. */
export const automationTasks = sqliteTable(
  "automation_tasks",
  {
    id: text("id").primaryKey(), // Plane work item id
    workspace: text("workspace").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    projectId: text("project_id").notNull(),
    projectIdentifier: text("project_identifier").notNull(),
    repo: text("repo").notNull(),
    status: text("status", { enum: ["running", "review", "failed", "interrupted"] }).notNull(),
    attempt: integer("attempt").notNull(),
    sessionId: text("session_id"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    error: text("error"),
  },
  (t) => [index("automation_tasks_started_idx").on(t.startedAt)],
)
