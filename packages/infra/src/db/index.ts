import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrations } from "./migrations.gen"
import * as schema from "./schema"

export { schema }
export type Db = ReturnType<typeof openDb>

/**
 * Opens the state database. WAL + busy_timeout allow the CLI (running the engine in-process)
 * and the daemon to use the same file concurrently.
 */
export function openDb(path: string) {
  const sqlite = new Database(path, { create: true, strict: true })
  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("PRAGMA busy_timeout = 5000")
  sqlite.exec("PRAGMA foreign_keys = ON")
  migrate(sqlite)
  return drizzle({ client: sqlite, schema })
}

function migrate(sqlite: Database) {
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS __migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  )
  const applied = new Set(
    sqlite
      .query<{ tag: string }, []>("SELECT tag FROM __migrations")
      .all()
      .map((r) => r.tag),
  )
  for (const m of migrations) {
    if (applied.has(m.tag)) continue
    sqlite.transaction(() => {
      for (const statement of m.sql.split("--> statement-breakpoint")) {
        if (statement.trim()) sqlite.exec(statement)
      }
      sqlite
        .query("INSERT INTO __migrations (tag, applied_at) VALUES (?, ?)")
        .run(m.tag, new Date().toISOString())
    })()
  }
}
