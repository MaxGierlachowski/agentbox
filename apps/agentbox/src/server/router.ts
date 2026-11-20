import { hostname } from "node:os"
import { implement, ORPCError, withEventMeta } from "@orpc/server"
import { contract, type Identity } from "@workspace/contract"
import type { SecretStore } from "@workspace/infra/secrets"
import pkg from "../../package.json" with { type: "json" }
import type { AutomationService } from "../automation/service"
import { runDemo } from "../runs/demo"
import type { RunService } from "../runs/service"
import type { ToolsService } from "../tools/service"

export interface RpcContext {
  identity: Identity | null
}

export interface RouterDeps {
  runs: RunService
  secrets: SecretStore
  tools: ToolsService
  automation: AutomationService
  startedAt: Date
}

const os = implement(contract).$context<RpcContext>()

const authed = os.middleware(({ context, next }) => {
  if (!context.identity) throw new ORPCError("UNAUTHORIZED")
  return next({ context: { identity: context.identity } })
})

export function createRouter({ runs, secrets, tools, automation, startedAt }: RouterDeps) {
  const active = new Map<string, AbortController>()

  return os.router({
    system: {
      info: os.system.info.use(authed).handler(() => ({
        version: pkg.version,
        hostname: hostname(),
        platform: process.platform,
        arch: process.arch,
        startedAt: startedAt.toISOString(),
      })),
    },
    auth: {
      me: os.auth.me.use(authed).handler(({ context }) => context.identity),
    },
    secrets: {
      status: os.secrets.status.use(authed).handler(async () => ({
        initialized: await secrets.isInitialized(),
        sealed: secrets.sealed,
      })),
      unlock: os.secrets.unlock.use(authed).handler(async ({ input }) => {
        if (await secrets.isInitialized()) {
          try {
            await secrets.unlock(input.passphrase)
          } catch (err) {
            throw new ORPCError("BAD_REQUEST", { message: (err as Error).message })
          }
        } else {
          await secrets.init(input.passphrase)
        }
        runs.setRedactions(secrets.values())
        return { initialized: true, sealed: false }
      }),
    },
    tools: {
      status: os.tools.status.use(authed).handler(() => tools.status()),
      save: os.tools.save.use(authed).handler(async ({ input }) => {
        if (secrets.sealed)
          throw new ORPCError("PRECONDITION_FAILED", { message: "Unlock agentbox first." })
        try {
          const status = await tools.save(input)
          runs.setRedactions(secrets.values())
          return status
        } catch (err) {
          throw new ORPCError("BAD_REQUEST", { message: (err as Error).message })
        }
      }),
    },
    automation: {
      status: os.automation.status.use(authed).handler(() => automation.status()),
      save: os.automation.save.use(authed).handler(({ input }) => automation.save(input)),
      pollNow: os.automation.pollNow.use(authed).handler(() => automation.pollNow()),
    },
    runs: {
      list: os.runs.list.use(authed).handler(({ input }) => runs.list(input.limit)),
      get: os.runs.get.use(authed).handler(({ input }) => {
        try {
          return runs.get(input.id)
        } catch {
          throw new ORPCError("NOT_FOUND")
        }
      }),
      demo: os.runs.demo.use(authed).handler(({ context }) => {
        const run = runs.create("apply", context.identity.login)
        const controller = new AbortController()
        active.set(run.id, controller)
        void runDemo(runs, run.id, controller.signal).finally(() => active.delete(run.id))
        return run
      }),
      cancel: os.runs.cancel.use(authed).handler(({ input }) => {
        const controller = active.get(input.id)
        controller?.abort()
        return { ok: Boolean(controller) }
      }),
      events: os.runs.events.use(authed).handler(async function* ({ input, lastEventId, signal }) {
        const from = lastEventId === undefined ? 0 : Number(lastEventId) + 1
        for await (const event of runs.stream(input.id, from, signal)) {
          yield withEventMeta(event, { id: String(event.seq) })
        }
      }),
    },
  })
}

export type AppRouter = ReturnType<typeof createRouter>
