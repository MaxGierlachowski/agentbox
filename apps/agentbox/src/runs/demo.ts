import type { RunService } from "./service"

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })

/**
 * Phase 0 walking skeleton: a synthetic run that exercises the event pipeline end to end
 * (ANSI colors, carriage-return progress, checks). Replaced by the engine in v0.1.
 */
export async function runDemo(runs: RunService, runId: string, signal: AbortSignal) {
  const steps = ["host.detect", "image", "repos"]
  for (const provider of steps) {
    if (signal.aborted) break
    const started = Date.now()
    runs.append(runId, { type: "provider.started", provider })
    for (let i = 1; i <= 10 && !signal.aborted; i++) {
      runs.append(runId, {
        type: "provider.log",
        provider,
        stream: "stdout",
        data: `\r\x1b[36m${provider}\x1b[0m progress ${"#".repeat(i).padEnd(10, ".")} ${i * 10}%`,
      })
      await sleep(150, signal)
    }
    runs.append(runId, { type: "provider.log", provider, stream: "stdout", data: "\r\n" })
    runs.append(runId, {
      type: "check.result",
      provider,
      id: `${provider}.ready`,
      status: provider === "repos" ? "warn" : "ok",
      message: provider === "repos" ? "shop-api has local changes, skipped fast-forward" : "ready",
    })
    runs.append(runId, {
      type: "provider.finished",
      provider,
      outcome: signal.aborted ? "cancelled" : "ok",
      durationMs: Date.now() - started,
    })
  }
  runs.append(runId, { type: "run.finished", status: signal.aborted ? "cancelled" : "succeeded" })
}
