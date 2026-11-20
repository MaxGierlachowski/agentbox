import { expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { openDb, schema } from "./index"

test("migrations apply and are idempotent", () => {
  const path = `/tmp/agentbox-db-test-${crypto.randomUUID()}.db`
  const db = openDb(path)
  db.insert(schema.runs)
    .values({
      id: "r1",
      workspace: "ws",
      kind: "apply",
      status: "running",
      actor: "test",
      startedAt: new Date().toISOString(),
    })
    .run()
  db.insert(schema.runEvents)
    .values({ runId: "r1", seq: 0, type: "run.started", payload: { a: 1 }, at: "now" })
    .run()

  const again = openDb(path)
  const events = again.select().from(schema.runEvents).where(eq(schema.runEvents.runId, "r1")).all()
  expect(events).toHaveLength(1)
  expect(events[0]?.payload).toEqual({ a: 1 })
})
