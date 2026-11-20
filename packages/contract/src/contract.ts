import { eventIterator, oc } from "@orpc/contract"
import { z } from "zod"
import { RunEvent, RunStatus } from "./events"
import { AutomationSettings, AutomationStatus, ToolsSaveInput, ToolsStatus } from "./tools"

const SystemInfo = z.object({
  version: z.string(),
  hostname: z.string(),
  platform: z.string(),
  arch: z.string(),
  startedAt: z.iso.datetime(),
})

const Identity = z.object({
  login: z.string(),
  name: z.string().nullable(),
  via: z.enum(["tailscale", "session", "cli"]),
})

const SealStatus = z.object({ initialized: z.boolean(), sealed: z.boolean() })

const RunSummary = z.object({
  id: z.string(),
  kind: z.enum(["plan", "apply", "verify"]),
  status: RunStatus,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  actor: z.string(),
})

export const contract = {
  system: {
    info: oc.route({ method: "GET" }).output(SystemInfo),
  },
  auth: {
    // Login links and logout are plain Hono routes (/auth/link, /auth/logout) because
    // they set cookies and redirect.
    me: oc.route({ method: "GET" }).output(Identity),
  },
  secrets: {
    status: oc.route({ method: "GET" }).output(SealStatus),
    unlock: oc.input(z.object({ passphrase: z.string().min(12) })).output(SealStatus),
  },
  tools: {
    status: oc.route({ method: "GET" }).output(ToolsStatus),
    /** Saves to the draft; takes effect on the next apply. Requires an unlocked secret store. */
    save: oc.input(ToolsSaveInput).output(ToolsStatus),
  },
  automation: {
    status: oc.route({ method: "GET" }).output(AutomationStatus),
    save: oc.input(AutomationSettings).output(AutomationStatus),
    /** Runs one polling round now. */
    pollNow: oc.output(AutomationStatus),
  },
  runs: {
    list: oc
      .route({ method: "GET" })
      .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
      .output(z.array(RunSummary)),
    get: oc
      .route({ method: "GET" })
      .input(z.object({ id: z.string() }))
      .output(RunSummary),
    /** Phase 0 walking skeleton: starts a synthetic run that exercises the event pipeline. */
    demo: oc.output(RunSummary),
    cancel: oc.input(z.object({ id: z.string() })).output(z.object({ ok: z.boolean() })),
    events: oc.input(z.object({ id: z.string() })).output(eventIterator(RunEvent)),
  },
}

export type Contract = typeof contract
export type SystemInfo = z.infer<typeof SystemInfo>
export type Identity = z.infer<typeof Identity>
export type SealStatus = z.infer<typeof SealStatus>
export type RunSummary = z.infer<typeof RunSummary>
