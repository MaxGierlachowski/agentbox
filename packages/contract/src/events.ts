import { z } from "zod"

/** Result of a single verify check, rendered green/yellow/red in the UI. */
export const CheckStatus = z.enum(["ok", "warn", "fail"])
export type CheckStatus = z.infer<typeof CheckStatus>

export const ProviderOutcome = z.enum(["ok", "failed", "skipped", "cancelled"])
export type ProviderOutcome = z.infer<typeof ProviderOutcome>

export const RunStatus = z.enum(["pending", "running", "succeeded", "failed", "cancelled"])
export type RunStatus = z.infer<typeof RunStatus>

const base = {
  runId: z.string(),
  /** Monotonic per run; doubles as the SSE event id for resuming streams. */
  seq: z.number().int().nonnegative(),
  at: z.iso.datetime(),
}

export const RunEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("run.started"), kind: z.enum(["plan", "apply", "verify"]) }),
  z.object({ ...base, type: z.literal("provider.started"), provider: z.string() }),
  z.object({
    ...base,
    type: z.literal("provider.log"),
    provider: z.string(),
    stream: z.enum(["stdout", "stderr", "info"]),
    data: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("provider.finished"),
    provider: z.string(),
    outcome: ProviderOutcome,
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    ...base,
    type: z.literal("check.result"),
    provider: z.string(),
    id: z.string(),
    status: CheckStatus,
    message: z.string(),
    hint: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal("run.finished"), status: RunStatus }),
])
export type RunEvent = z.infer<typeof RunEvent>

export const isTerminalEvent = (event: RunEvent) => event.type === "run.finished"
