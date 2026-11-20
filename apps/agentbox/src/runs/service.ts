import type { RunEvent, RunSummary } from "@workspace/contract"
import type { Db } from "@workspace/infra/db"
import { schema } from "@workspace/infra/db"
import { and, asc, desc, eq, gte } from "drizzle-orm"

type EventInput = RunEvent extends infer E
  ? E extends RunEvent
    ? Omit<E, "runId" | "seq" | "at">
    : never
  : never

const POLL_MS = 1000

/**
 * Persists run events and fans them out to live subscribers.
 *
 * SQLite is the source of truth, so a stream can resume from any `seq` after a reconnect.
 * In-process appends wake subscribers immediately; runs written by another process (the CLI
 * running the engine in-process) are picked up by polling.
 */
export class RunService {
  private readonly seqs = new Map<string, number>()
  private readonly waiters = new Map<string, Set<() => void>>()
  private readonly redactions = new Set<string>()

  constructor(
    private readonly db: Db,
    private readonly workspace = "default",
  ) {}

  /** Values that must never appear in logs (secret plaintexts). */
  setRedactions(values: Iterable<string>) {
    this.redactions.clear()
    for (const v of values) if (v.length >= 4) this.redactions.add(v)
  }

  create(kind: RunSummary["kind"], actor: string): RunSummary {
    const run = {
      id: crypto.randomUUID(),
      workspace: this.workspace,
      kind,
      status: "running" as const,
      actor,
      startedAt: new Date().toISOString(),
    }
    this.db.insert(schema.runs).values(run).run()
    this.seqs.set(run.id, 0)
    this.append(run.id, { type: "run.started", kind })
    return this.get(run.id)
  }

  append(runId: string, event: EventInput) {
    const seq = this.seqs.get(runId) ?? 0
    this.seqs.set(runId, seq + 1)
    const full = this.redact({ ...event, runId, seq, at: new Date().toISOString() } as RunEvent)
    this.db
      .insert(schema.runEvents)
      .values({ runId, seq, type: full.type, payload: full, at: full.at })
      .run()
    if (full.type === "run.finished") {
      this.db
        .update(schema.runs)
        .set({ status: full.status, finishedAt: full.at })
        .where(eq(schema.runs.id, runId))
        .run()
      this.seqs.delete(runId)
    }
    for (const wake of this.waiters.get(runId) ?? []) wake()
  }

  get(id: string): RunSummary {
    const run = this.db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()
    if (!run) throw new Error(`Run ${id} not found`)
    return toSummary(run)
  }

  list(limit: number): RunSummary[] {
    return this.db
      .select()
      .from(schema.runs)
      .orderBy(desc(schema.runs.startedAt))
      .limit(limit)
      .all()
      .map(toSummary)
  }

  /** Yields events from `fromSeq` on, then follows live until the run finishes. */
  async *stream(runId: string, fromSeq: number, signal?: AbortSignal): AsyncGenerator<RunEvent> {
    let next = fromSeq
    while (!signal?.aborted) {
      // Register the waiter before reading, so an append between read and wait is not lost.
      const woke = this.waitFor(runId, signal)
      const rows = this.db
        .select()
        .from(schema.runEvents)
        .where(and(eq(schema.runEvents.runId, runId), gte(schema.runEvents.seq, next)))
        .orderBy(asc(schema.runEvents.seq))
        .all()
      for (const row of rows) {
        const event = row.payload as RunEvent
        next = event.seq + 1
        yield event
        if (event.type === "run.finished") {
          woke.cancel()
          return
        }
      }
      await woke.promise
    }
  }

  private waitFor(runId: string, signal?: AbortSignal) {
    let wake!: () => void
    const promise = new Promise<void>((resolve) => {
      wake = resolve
    })
    const set = this.waiters.get(runId) ?? new Set()
    this.waiters.set(runId, set)
    set.add(wake)
    const timer = setTimeout(wake, POLL_MS)
    const onAbort = () => wake()
    signal?.addEventListener("abort", onAbort, { once: true })
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      set.delete(wake)
      if (set.size === 0) this.waiters.delete(runId)
    }
    promise.then(cleanup)
    return { promise, cancel: () => wake() }
  }

  private redact(event: RunEvent): RunEvent {
    if (event.type !== "provider.log" || this.redactions.size === 0) return event
    let data = event.data
    for (const secret of this.redactions) {
      for (const variant of [
        secret,
        Buffer.from(secret).toString("base64"),
        encodeURIComponent(secret),
      ]) {
        data = data.replaceAll(variant, "***")
      }
    }
    return { ...event, data }
  }
}

function toSummary(run: typeof schema.runs.$inferSelect): RunSummary {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    actor: run.actor,
  }
}
