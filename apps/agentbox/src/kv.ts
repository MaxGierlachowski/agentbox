import type { Db } from "@workspace/infra/db"
import { schema } from "@workspace/infra/db"
import { eq } from "drizzle-orm"

/** Small JSON documents in SQLite (onboarding state, installed items, caches). */
export class Kv {
  constructor(private readonly db: Db) {}

  get<T>(key: string): T | null {
    const row = this.db.select().from(schema.kv).where(eq(schema.kv.key, key)).get()
    return row ? (row.value as T) : null
  }

  set<T>(key: string, value: T) {
    const updatedAt = new Date().toISOString()
    this.db
      .insert(schema.kv)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({ target: schema.kv.key, set: { value, updatedAt } })
      .run()
  }

  delete(key: string) {
    this.db.delete(schema.kv).where(eq(schema.kv.key, key)).run()
  }
}
