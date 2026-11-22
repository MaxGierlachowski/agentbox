"use client"

import { useQueryClient } from "@tanstack/react-query"
import type { RunEvent, RunStatus } from "@workspace/contract"
import { useEffect, useEffectEvent, useState } from "react"
import { client } from "./orpc"

export interface RunStreamState {
  events: RunEvent[]
  chunks: string[]
  status: RunStatus | "connecting"
  error: string | null
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const color = { ok: 32, warn: 33, fail: 31 } as const

/** Renders an event as terminal output. */
function toChunk(e: RunEvent): string | null {
  switch (e.type) {
    case "run.started":
      return `${bold(`${e.kind} started`)}\r\n`
    case "provider.started":
      return `\r\n${bold(`▶ ${e.provider}`)}\r\n`
    case "provider.log":
      return e.data
    case "check.result":
      return `  \x1b[${color[e.status]}m${e.status.toUpperCase()}\x1b[0m ${e.id}: ${e.message}\r\n`
    case "provider.finished":
      return `\x1b[2m  ${e.provider} ${e.outcome} in ${(e.durationMs / 1000).toFixed(1)}s\x1b[0m\r\n`
    case "run.finished":
      return `\r\n${bold(`run ${e.status}`)}\r\n`
  }
}

/**
 * Follows a run's event stream. Reconnects forever on network errors; the retry plugin sends
 * the last seen event id, so the server replays exactly what was missed.
 */
export function useRunEvents(
  runId: string | null,
  onFinished?: (status: RunStatus) => void,
): RunStreamState {
  const queryClient = useQueryClient()
  const [state, setState] = useState<RunStreamState & { runId: string | null }>({
    ...initial,
    runId: null,
  })
  const finished = useEffectEvent((status: RunStatus) => onFinished?.(status))

  useEffect(() => {
    if (!runId) return
    const controller = new AbortController()
    void (async () => {
      try {
        const stream = await client.runs.events(
          { id: runId },
          { signal: controller.signal, context: { retry: Number.POSITIVE_INFINITY } },
        )
        for await (const event of stream) {
          setState((prev) => {
            const s = prev.runId === runId ? prev : { ...initial, runId }
            const chunk = toChunk(event)
            return {
              runId,
              events: [...s.events, event],
              chunks: chunk ? [...s.chunks, chunk] : s.chunks,
              status: event.type === "run.finished" ? event.status : "running",
              error: null,
            }
          })
          if (event.type === "run.finished") {
            void queryClient.invalidateQueries()
            finished(event.status)
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          const error = err instanceof Error ? err.message : String(err)
          setState((prev) => ({ ...(prev.runId === runId ? prev : { ...initial, runId }), error }))
        }
      }
    })()
    return () => controller.abort()
  }, [runId, queryClient])

  // A new run id shows an empty log until its first event arrives.
  return state.runId === runId ? state : initial
}

const initial: RunStreamState = { events: [], chunks: [], status: "connecting", error: null }
