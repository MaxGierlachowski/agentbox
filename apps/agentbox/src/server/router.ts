import { implement, ORPCError, withEventMeta } from "@orpc/server"
import { contract, type Identity } from "@workspace/contract"
import type { Via } from "../auth/auth"
import type { Services } from "../services"

export interface RpcContext {
  identity: Identity | null
  via: Via
}

const os = implement(contract).$context<RpcContext>()

const authed = os.middleware(({ context, next }) => {
  if (!context.identity) throw new ORPCError("UNAUTHORIZED")
  return next({ context: { identity: context.identity } })
})

const cliOnly = os.middleware(({ context, next }) => {
  if (context.identity?.via !== "cli") throw new ORPCError("FORBIDDEN")
  return next()
})

/** Maps service errors to 400s with their message; ORPCErrors pass through. */
async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ORPCError) throw err
    throw new ORPCError("BAD_REQUEST", { message: (err as Error).message })
  }
}

export function createRouter(s: Services) {
  const a = os.use(authed)
  return os.router({
    system: {
      info: a.system.info.handler(() => s.system.info()),
      doctor: a.system.doctor.handler(() => guard(() => s.system.doctor())),
      services: a.system.services.handler(() => guard(() => s.system.services())),
    },
    auth: {
      me: a.auth.me.handler(({ context }) => context.identity),
      changePassword: a.auth.changePassword.handler(({ input }) =>
        guard(async () => {
          if (!(await s.auth.verifyPassword(input.current)))
            throw new Error("The current password is wrong")
          await s.auth.setPassword(input.next)
          return { ok: true }
        }),
      ),
    },
    admin: {
      issueOtp: a.admin.issueOtp.use(cliOnly).handler(({ input }) => {
        if (input.purpose === "claim" && s.auth.hasOwner())
          throw new ORPCError("CONFLICT", {
            message: "The box is already claimed; use `agentbox reset-owner`.",
          })
        if (input.purpose === "reset" && !s.auth.hasOwner())
          throw new ORPCError("CONFLICT", {
            message: "Nobody has claimed the box yet; use `agentbox otp`.",
          })
        const { otp, expiresAt } = s.auth.issueOtp(input.purpose)
        return { otp, expiresAt: expiresAt.toISOString() }
      }),
    },
    onboarding: {
      get: a.onboarding.get.handler(() => s.onboarding.get()),
      save: a.onboarding.save.handler(({ input }) => guard(() => s.onboarding.save(input))),
      complete: a.onboarding.complete.handler(() => guard(() => s.onboarding.complete())),
    },
    ai: {
      status: a.ai.status.handler(() => guard(() => s.ai.status())),
      accountLoginStart: a.ai.accountLoginStart.handler(({ input }) =>
        guard(() => s.ai.accountLoginStart(input.label)),
      ),
      accountLoginFinish: a.ai.accountLoginFinish.handler(({ input }) =>
        guard(() => s.ai.accountLoginFinish(input.flowId, input.code)),
      ),
      accountRemove: a.ai.accountRemove.handler(({ input }) =>
        guard(() => s.ai.accountRemove(input.slug)),
      ),
      accountSetDefault: a.ai.accountSetDefault.handler(({ input }) =>
        guard(() => s.ai.accountSetDefault(input.slug)),
      ),
      setApiKey: a.ai.setApiKey.handler(({ input }) =>
        guard(() => s.ai.setApiKey(input.provider, input.key)),
      ),
      removeApiKey: a.ai.removeApiKey.handler(({ input }) =>
        guard(() => s.ai.removeApiKey(input.provider)),
      ),
      setHermesModel: a.ai.setHermesModel.handler(({ input }) =>
        guard(() => s.ai.setHermesModel(input)),
      ),
      probe: a.ai.probe.handler(() => guard(() => s.ai.probe())),
    },
    flows: {
      get: a.flows.get.handler(({ input }) => guard(() => s.flows.get(input.flowId))),
      cancel: a.flows.cancel.handler(({ input }) => guard(() => s.flows.cancel(input.flowId))),
    },
    catalog: {
      search: a.catalog.search.handler(({ input }) => guard(() => s.catalog.search(input))),
      get: a.catalog.get.handler(({ input }) => guard(() => s.catalog.get(input.id))),
      suggest: a.catalog.suggest.handler(({ input }) => guard(() => s.catalog.suggest(input))),
    },
    toolkit: {
      get: a.toolkit.get.handler(() => guard(() => s.toolkit.get())),
      apply: a.toolkit.apply.handler(({ input, context }) =>
        guard(() => s.toolkit.apply(input.add, input.remove, context.identity.login, input.env)),
      ),
      connect: a.toolkit.connect.handler(({ input }) => guard(() => s.toolkit.connect(input.id))),
    },
    soul: {
      get: a.soul.get.handler(() => guard(() => s.soul.get())),
      save: a.soul.save.handler(({ input }) => guard(() => s.soul.save(input.markdown))),
      regenerate: a.soul.regenerate.handler(({ input }) =>
        guard(() => s.soul.regenerate(input.ai)),
      ),
    },
    clis: {
      status: a.clis.status.handler(() => guard(() => s.clis.status())),
      authStart: a.clis.authStart.handler(({ input }) =>
        guard(() => s.clis.authStart(input.cli, input.host)),
      ),
      setToken: a.clis.setToken.handler(({ input }) =>
        guard(() => s.clis.setToken(input.cli, input.host, input.token)),
      ),
    },
    git: {
      identity: a.git.identity.handler(() => guard(() => s.git.identity())),
      setIdentity: a.git.setIdentity.handler(({ input }) => guard(() => s.git.setIdentity(input))),
    },
    ssh: {
      status: a.ssh.status.handler(() => guard(() => s.git.sshStatus())),
      generate: a.ssh.generate.handler(() => guard(() => s.git.sshGenerate())),
      register: a.ssh.register.handler(({ input }) => guard(() => s.git.sshRegister(input.host))),
    },
    repos: {
      list: a.repos.list.handler(({ input }) => guard(() => s.git.listRemote(input.host))),
      local: a.repos.local.handler(() => guard(() => s.git.listLocal())),
      clone: a.repos.clone.handler(({ input, context }) =>
        guard(() => s.git.clone(input.repos, context.identity.login)),
      ),
    },
    profiles: {
      list: a.profiles.list.handler(() => guard(() => s.profiles.list())),
      draft: a.profiles.draft.handler(() => guard(() => s.profiles.draft())),
      create: a.profiles.create.handler(({ input }) => guard(() => s.profiles.create(input))),
      remove: a.profiles.remove.handler(({ input }) => guard(() => s.profiles.remove(input.slug))),
    },
    browser: {
      status: a.browser.status.handler(() => guard(() => s.browser.status())),
      setLock: a.browser.setLock.handler(({ input }) =>
        guard(() => s.browser.setLock(input.locked)),
      ),
      open: a.browser.open.handler(({ input }) => guard(() => s.browser.open(input.url))),
    },
    devices: {
      list: a.devices.list.handler(() => s.devices.list()),
      pairStart: a.devices.pairStart.handler(({ input }) =>
        guard(() => s.devices.pairStart(input.kind)),
      ),
      revoke: a.devices.revoke.handler(({ input }) =>
        guard(async () => ({ ok: await s.devices.revoke(input.id) })),
      ),
    },
    runs: {
      list: a.runs.list.handler(({ input }) => s.runs.list(input.limit)),
      get: a.runs.get.handler(({ input }) => {
        try {
          return s.runs.get(input.id)
        } catch {
          throw new ORPCError("NOT_FOUND")
        }
      }),
      cancel: a.runs.cancel.handler(({ input }) => ({ ok: s.runs.cancel(input.id) })),
      events: a.runs.events.handler(async function* ({ input, lastEventId, signal }) {
        const from = lastEventId === undefined ? 0 : Number(lastEventId) + 1
        for await (const event of s.runs.stream(input.id, from, signal)) {
          yield withEventMeta(event, { id: String(event.seq) })
        }
      }),
    },
  })
}

export type AppRouter = ReturnType<typeof createRouter>
