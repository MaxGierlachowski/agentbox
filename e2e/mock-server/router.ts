import { implement, ORPCError, withEventMeta } from "@orpc/server"
import type {
  CatalogHit,
  CliStatus,
  LoginFlow,
  ProfileDraft,
  RunEvent,
  RunSummary,
  Selection,
} from "@workspace/contract"
import { BASE, BUNDLES, bundleIds, byId, CATALOG } from "./catalog"
import { contractNext } from "./contract-next"
import type { MockState, RunEntry } from "./state"

export interface MockContext {
  session: string | null
}

const os = implement(contractNext).$context<MockContext>()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const now = () => new Date().toISOString()
const rid = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`

const kindKey = { skill: "skills", mcp: "mcps", cli: "clis" } as const

function toSelection(ids: string[]): Selection {
  const sel: Selection = { skills: [], mcps: [], clis: [] }
  for (const id of ids) {
    const kind = id.split(".")[0] as keyof typeof kindKey
    if (kindKey[kind] && !sel[kindKey[kind]].includes(id)) sel[kindKey[kind]].push(id)
  }
  return sel
}

const selectionIds = (s: Selection) => [...s.skills, ...s.mcps, ...s.clis]

export function createRouter(getState: () => MockState) {
  const s = () => getState()

  const authed = os.middleware(({ context, next }) => {
    if (!context.session || !s().sessions.has(context.session)) {
      throw new ORPCError("UNAUTHORIZED", { message: "Sign in first" })
    }
    return next()
  })
  const a = os.use(authed)

  const hit = (id: string, reason: string | null = null): CatalogHit | null => {
    const item = byId.get(id)
    if (!item) return null
    const installed = selectionIds(s().installed).includes(id)
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      summary: item.summary,
      tier: item.tier,
      source: item.source,
      licence: item.licence,
      roles: item.roles,
      needsAuth: item.auth.type !== "none",
      reason,
      installed,
      homepage: item.homepage ?? null,
    }
  }

  // ---- runs --------------------------------------------------------------------------------

  function startRun(
    kind: RunSummary["kind"],
    title: string,
    steps: { provider: string; lines: string[] }[],
    onDone?: () => void,
  ): RunSummary {
    const summary: RunSummary = {
      id: rid("run"),
      kind,
      title,
      status: "running",
      startedAt: now(),
      finishedAt: null,
      actor: "owner",
    }
    const entry: RunEntry = { summary, events: [], cancelled: false }
    s().runs.set(summary.id, entry)
    type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
    const push = (e: DistributiveOmit<RunEvent, "runId" | "seq" | "at">) =>
      entry.events.push({
        ...e,
        runId: summary.id,
        seq: entry.events.length,
        at: now(),
      } as RunEvent)
    void (async () => {
      push({ type: "run.started", kind })
      for (const step of steps) {
        if (entry.cancelled) break
        const started = Date.now()
        push({ type: "provider.started", provider: step.provider })
        for (const line of step.lines) {
          await sleep(120)
          if (entry.cancelled) break
          push({
            type: "provider.log",
            provider: step.provider,
            stream: "stdout",
            data: `${line}\r\n`,
          })
        }
        push({
          type: "provider.finished",
          provider: step.provider,
          outcome: entry.cancelled ? "cancelled" : "ok",
          durationMs: Date.now() - started,
        })
        if (!entry.cancelled) {
          push({
            type: "check.result",
            provider: step.provider,
            id: `${step.provider}.ready`,
            status: "ok",
            message: "ready",
          })
        }
      }
      const status = entry.cancelled ? "cancelled" : "succeeded"
      if (!entry.cancelled) onDone?.()
      summary.status = status
      summary.finishedAt = now()
      push({ type: "run.finished", status })
    })()
    return summary
  }

  // ---- flows -------------------------------------------------------------------------------

  function advanceFlow(flowId: string): LoginFlow {
    const entry = s().flows.get(flowId)
    if (!entry) throw new ORPCError("NOT_FOUND", { message: "Unknown flow" })
    const f = entry.flow
    if (f.state !== "waiting" && f.state !== "starting") return f
    if ((entry.kind === "claude" || entry.kind === "hermes") && !entry.pasted) return f
    entry.pollsLeft -= 1
    if (entry.pollsLeft > 0) return f
    if (entry.kind === "oauth") {
      s().oauth.add(entry.item ?? "")
      Object.assign(f, { state: "done", user: s().owner?.email ?? "you", message: null })
      return f
    }
    if (entry.kind === "hermes") {
      s().hermesClaude = true
      s().ai.hermes = {
        source: "claude-account",
        provider: "anthropic",
        model: entry.model ?? "claude-sonnet-5",
        ready: true,
        message: null,
      }
      Object.assign(f, { state: "done", user: s().owner?.email ?? "you", message: "Signed in" })
      return f
    }
    if (entry.kind === "claude") {
      const acct = s().ai.accounts.find((x) => x.slug === entry.slug)
      const email = `${entry.slug}@example.org`
      if (acct) Object.assign(acct, { status: "ready", email, message: null })
      Object.assign(f, { state: "done", user: email, message: "Signed in" })
    } else {
      const cli = s().clis[entry.kind]
      const user = entry.kind === "gh" ? "ada-example" : "ada.example"
      Object.assign(cli, { authed: true, user, host: entry.host ?? cli.host })
      Object.assign(f, { state: "done", user, message: null })
    }
    return f
  }

  // ---- soul --------------------------------------------------------------------------------

  function soulGenerated() {
    const st = s()
    const accounts = st.ai.accounts.filter((x) => x.status === "ready").map((x) => x.label)
    const authed = Object.values(st.clis)
      .filter((c) => c.authed)
      .map((c) => `${c.id} (@${c.user})`)
    return [
      "<!-- agentbox:generated -->",
      "# This box",
      "- Coding work goes to Paseo agents via the `paseo` MCP (paseo_create_agent with cwd in ~/work/...).",
      "  Their events come back into this session automatically; don't poll in a loop.",
      `- Claude accounts: ${accounts.join(", ") || "none yet"}.`,
      `- Repos: ${[...st.cloned].join(", ") || "none yet"} under /home/agentbox/work/<host>/<owner>/<repo>.`,
      "- Browser: one shared, logged-in Chrome. Attach via CDP http://127.0.0.1:9333 (browser-harness).",
      "  If /var/lib/agentbox/browser.lock exists, the human is using it: wait.",
      `- CLIs authenticated: ${authed.join(", ") || "none"}. Git identity: ${st.git ? `${st.git.name} <${st.git.email}>` : "not set"}.`,
      `- MCP servers: ${st.onboarding.selection.mcps.map((m) => m.replace("mcp.", "")).join(", ") || "paseo"}.`,
      "<!-- /agentbox:generated -->",
    ].join("\n")
  }

  function soulUserDefault() {
    const st = s()
    const name = st.owner?.name ?? "you"
    return [
      "# Who you are",
      `You are Hermes, ${name}'s assistant on their personal Agentbox (agentbox-demo).`,
      `You work for ${name} only. Language: ${st.onboarding.language}. Timezone: ${st.onboarding.timezone}.`,
      "",
      "# How you work",
      "- Be direct. Lead with the outcome. Short answers for short questions.",
      "- Do the work with tools; never invent output. If blocked, say so and propose the next step.",
      "- Ask before anything irreversible or outward-facing (sending mail, posting, merging, deleting, paying).",
      "- Secrets: never print, log or paste credentials.",
      "",
      `# About ${name}`,
      st.onboarding.about || "(Tell Hermes about your work here.)",
      `Roles: ${st.onboarding.roles.join(", ") || "not set"}`,
    ].join("\n")
  }

  function soul() {
    const st = s()
    if (!st.soulUser) st.soulUser = soulUserDefault()
    const generated = soulGenerated()
    return { markdown: `${st.soulUser}\n\n${generated}\n`, generated }
  }

  const stripGenerated = (md: string) =>
    md.replace(/<!-- agentbox:generated -->[\s\S]*?<!-- \/agentbox:generated -->\n?/g, "").trimEnd()

  // ---- profiles ----------------------------------------------------------------------------

  function drafts(): ProfileDraft[] {
    const roles = s().onboarding.roles
    const out: ProfileDraft[] = []
    if (roles.includes("developer") || roles.length === 0) {
      out.push({
        slug: "reviewer",
        name: "Reviewer",
        role: "developer",
        purpose: "Reviews open pull requests and flags risky changes before you merge.",
        skills: ["skill.github", "skill.requesting-code-review"],
        mcps: ["mcp.github"],
        crons: [
          {
            name: "Morning PR digest",
            schedule: "0 8 * * 1-5",
            prompt: "Summarise open PRs that need my review.",
            enabled: false,
          },
        ],
        soul: "# Reviewer\nYou review pull requests. Be specific, cite lines, rank risk. Never merge.",
      })
    }
    out.push({
      slug: "inbox",
      name: "Inbox assistant",
      role: "manager",
      purpose: "Triages your inbox every morning and drafts replies. Never sends.",
      skills: ["skill.email-inbox-triage"],
      mcps: ["mcp.gmail"],
      crons: [
        {
          name: "Morning brief",
          schedule: "30 7 * * 1-5",
          prompt: "Brief me on today's calendar and urgent mail.",
          enabled: false,
        },
      ],
      soul: "# Inbox assistant\nYou triage mail. Draft, never send. Summaries with owners and dates.",
    })
    if (roles.includes("devops")) {
      out.push({
        slug: "ops",
        name: "Ops",
        role: "ops",
        purpose: "Watches alerts and proposes a rollback before a fix.",
        skills: [],
        mcps: ["mcp.grafana", "mcp.sentry"],
        crons: [],
        soul: "# Ops\nTriage by impact. Check recent deploys first. No prod writes without approval.",
      })
    }
    return out.slice(0, 3)
  }

  const cliFor = (id: "gh" | "glab"): CliStatus => s().clis[id]

  return os.router({
    system: {
      info: a.system.info.handler(() => ({
        version: "0.1.0-mock",
        hostname: "agentbox-demo",
        platform: "linux",
        arch: "x64",
        startedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
        listen: "lan" as const,
        lanUrl: "https://192.168.1.50:8443",
        certFingerprint:
          "3F:A1:7C:22:9B:41:0D:E8:55:AA:13:6F:90:C4:2B:7E:11:D3:88:5C:0F:4A:B9:62:EE:07:31:C8:9D:46:2A:9C",
        pwaUrl: "https://maxgierlachowski.github.io/hermes-ui",
      })),
      doctor: a.system.doctor.handler(() => ({
        checks: [
          { id: "services", level: "ok" as const, message: "9/9 services healthy" },
          {
            id: "cdp-exposure",
            level: "ok" as const,
            message: "Chrome CDP listens on 127.0.0.1 only",
          },
          {
            id: "disk",
            level: "warn" as const,
            message: "Disk 81% full on /home (12 GB free)",
          },
          {
            id: "hermes-model",
            level: s().ai.hermes.ready ? ("ok" as const) : ("fail" as const),
            message: s().ai.hermes.ready ? "Hermes answers" : "Hermes has no model yet",
          },
        ],
      })),
      services: a.system.services.handler(() =>
        [
          ["hermes", "Hermes agent"],
          ["hermes-ui", "Hermes UI"],
          ["paseo", "Paseo daemon"],
          ["caddy", "Caddy"],
          ["iroh", "iroh gateway"],
          ["browser", "Chrome + KasmVNC"],
        ].map(([id, label]) => ({
          id: id as string,
          unit: `agentbox-${id}.service`,
          label: label as string,
          active: true,
          healthy: id !== "iroh" || s().devices.length > 0 || s().pairing !== null,
          message:
            id === "iroh" && s().devices.length === 0 && !s().pairing
              ? "closed (no devices)"
              : "ok",
        })),
      ),
    },
    auth: {
      me: a.auth.me.handler(() => ({
        login: s().owner?.email ?? "owner",
        name: s().owner?.name ?? null,
        via: "session" as const,
      })),
      changePassword: a.auth.changePassword.handler(({ input }) => {
        const owner = s().owner
        if (!owner || owner.password !== input.current)
          throw new ORPCError("BAD_REQUEST", { message: "The current password is wrong" })
        owner.password = input.next
        return { ok: true }
      }),
    },
    admin: {
      issueOtp: a.admin.issueOtp.handler(() => ({
        otp: "mock-otp-code",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      })),
    },
    onboarding: {
      get: a.onboarding.get.handler(() => s().onboarding),
      save: a.onboarding.save.handler(({ input }) => {
        const st = s()
        st.onboarding = { ...st.onboarding, ...input }
        if (input.about !== undefined || input.roles) st.soulUser = ""
        return st.onboarding
      }),
      complete: a.onboarding.complete.handler(() => {
        const st = s()
        st.onboarding.finishedAt = now()
        const task = st.onboarding.firstTask
        return { redirect: task ? `/hermes/?compose=${encodeURIComponent(task)}` : "/hermes/" }
      }),
    },
    ai: {
      status: a.ai.status.handler(() => s().ai),
      accountLoginStart: a.ai.accountLoginStart.handler(({ input }) => {
        const st = s()
        let slug =
          input.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "account"
        while (st.ai.accounts.some((x) => x.slug === slug)) slug = `${slug}-2`
        st.ai.accounts.push({
          slug,
          label: input.label,
          status: "pending",
          email: null,
          message: "Waiting for the code from the Claude page",
          isDefault: st.ai.accounts.length === 0,
        })
        const flow: LoginFlow = {
          flowId: rid("flow"),
          url: `https://claude.ai/oauth/authorize?code=true&client_id=mock&state=${slug}`,
          code: null,
          needsPaste: true,
          state: "waiting",
          message: null,
          user: null,
        }
        st.flows.set(flow.flowId, { flow, kind: "claude", pollsLeft: 2, pasted: false, slug })
        return flow
      }),
      hermesLoginStart: a.ai.hermesLoginStart.handler(({ input }) => {
        const flow: LoginFlow = {
          flowId: rid("flow"),
          url: "https://claude.ai/oauth/authorize?code=true&client_id=mock-hermes",
          code: null,
          needsPaste: true,
          state: "waiting",
          message: null,
          user: null,
        }
        s().flows.set(flow.flowId, {
          flow,
          kind: "hermes",
          pollsLeft: 2,
          pasted: false,
          model: input.model,
        })
        return flow
      }),
      accountLoginFinish: a.ai.accountLoginFinish.handler(({ input }) => {
        const entry = s().flows.get(input.flowId)
        if (!entry) throw new ORPCError("NOT_FOUND", { message: "Unknown flow" })
        if (input.code.trim() === "wrong-code") {
          throw new ORPCError("BAD_REQUEST", {
            message: "Claude rejected this code. Copy it again.",
          })
        }
        entry.pasted = true
        Object.assign(entry.flow, { state: "starting", message: "Checking the code…" })
        return entry.flow
      }),
      accountRemove: a.ai.accountRemove.handler(({ input }) => {
        const st = s()
        st.ai.accounts = st.ai.accounts.filter((x) => x.slug !== input.slug)
        if (st.ai.accounts.length && !st.ai.accounts.some((x) => x.isDefault)) {
          const first = st.ai.accounts[0]
          if (first) first.isDefault = true
        }
        return { ok: true }
      }),
      accountSetDefault: a.ai.accountSetDefault.handler(({ input }) => {
        for (const x of s().ai.accounts) x.isDefault = x.slug === input.slug
        return { ok: true }
      }),
      setApiKey: a.ai.setApiKey.handler(async ({ input }) => {
        await sleep(400)
        if (input.key.includes("invalid"))
          throw new ORPCError("BAD_REQUEST", { message: "The provider rejected this key." })
        s().apiKeyValues.set(input.provider, input.key)
        const k = s().ai.apiKeys.find((x) => x.provider === input.provider)
        if (k) Object.assign(k, { set: true, last4: input.key.slice(-4) })
        return { ok: true }
      }),
      removeApiKey: a.ai.removeApiKey.handler(({ input }) => {
        s().apiKeyValues.delete(input.provider)
        const k = s().ai.apiKeys.find((x) => x.provider === input.provider)
        if (k) Object.assign(k, { set: false, last4: null })
        return { ok: true }
      }),
      setHermesModel: a.ai.setHermesModel.handler(({ input }) => {
        const st = s()
        if (input.source === "claude-account") {
          if (!st.hermesClaude)
            throw new ORPCError("BAD_REQUEST", {
              message: "Sign Hermes in with your Claude subscription first",
            })
        } else if (!st.ai.apiKeys.find((k) => k.provider === input.provider)?.set) {
          throw new ORPCError("BAD_REQUEST", { message: `Add a ${input.provider} API key first` })
        }
        st.ai.hermes = {
          source: input.source,
          provider: input.provider,
          model: input.model,
          ready: true,
          message: null,
        }
        return st.ai
      }),
      probe: a.ai.probe.handler(async () => {
        await sleep(500)
        const h = s().ai.hermes
        return h.ready
          ? { ok: true, reply: "pong — Hermes is listening.", message: null }
          : { ok: false, reply: null, message: "Hermes has no model yet. Pick one above." }
      }),
    },
    flows: {
      get: a.flows.get.handler(({ input }) => advanceFlow(input.flowId)),
      cancel: a.flows.cancel.handler(({ input }) => {
        const entry = s().flows.get(input.flowId)
        if (entry) Object.assign(entry.flow, { state: "cancelled", message: "Cancelled" })
        if (entry?.kind === "claude") {
          s().ai.accounts = s().ai.accounts.filter((x) => x.slug !== entry.slug)
        }
        return { ok: true }
      }),
    },
    catalog: {
      search: a.catalog.search.handler(async ({ input }) => {
        await sleep(120)
        const q = input.q.trim().toLowerCase()
        return CATALOG.filter((i) => !input.kind || i.kind === input.kind)
          .filter(
            (i) =>
              !q ||
              i.name.toLowerCase().includes(q) ||
              i.summary.toLowerCase().includes(q) ||
              i.id.includes(q) ||
              i.tags.some((t) => t.includes(q)),
          )
          .map((i) => ({
            score:
              ({ T0: 4, T1: 3, T2: 2, T3: 1 } as const)[i.tier] *
              (input.roles?.some((r) => i.roles.includes(r)) ? 1.5 : 1) *
              (i.name.toLowerCase().startsWith(q) ? 2 : 1),
            i,
          }))
          .sort((x, y) => y.score - x.score)
          .slice(0, input.limit)
          .map(({ i }) => hit(i.id) as CatalogHit)
      }),
      get: a.catalog.get.handler(({ input }) => {
        const h = hit(input.id)
        if (!h) throw new ORPCError("NOT_FOUND", { message: `Unknown item ${input.id}` })
        return { ...h, detail: byId.get(input.id) }
      }),
      suggest: a.catalog.suggest.handler(async ({ input }) => {
        await sleep(input.refine ? 900 : 200)
        const reasons: Record<string, string> = {}
        const selected = new Set<string>()
        const bundles = [
          ...(BASE ? [BASE] : []),
          ...BUNDLES.filter((b) => b.id !== "base" && b.roles.some((r) => input.roles.includes(r))),
        ]
        for (const b of bundles) {
          for (const id of bundleIds(b)) {
            const optional = b.opt_in.includes(id)
            if (!optional) {
              selected.add(id)
              reasons[id] = b.id === "base" ? "Part of every box" : `In the ${b.name} bundle`
            } else if (!selected.has(id)) {
              reasons[id] ??= `Optional in the ${b.name} bundle`
            }
          }
        }
        if (
          input.refine &&
          input.about?.toLowerCase().includes("sentry") &&
          byId.has("mcp.sentry")
        ) {
          selected.add("mcp.sentry")
          reasons["mcp.sentry"] = "You mentioned Sentry"
        }
        const primary = bundles.find((b) => b.id !== "base") ?? BASE
        const sites = [...new Set(bundles.flatMap((b) => b.suggested_sites.map((x) => x.url)))]
        return {
          selection: toSelection([...selected]),
          reasons,
          firstTask: primary?.first_task ?? "Tell me what you can do on this box.",
          firstTaskAlternatives: primary ? [...primary.first_task_alternatives] : [],
          suggestedSites: sites,
          items: Object.keys(reasons)
            .map((id) => hit(id, reasons[id]))
            .filter((x): x is CatalogHit => !!x),
        }
      }),
    },
    toolkit: {
      get: a.toolkit.get.handler(() => ({
        selection: s().onboarding.selection,
        installed: s().installed,
      })),
      apply: a.toolkit.apply.handler(({ input }) => {
        const add = input.add.filter((id) => !selectionIds(s().installed).includes(id))
        for (const [id, values] of Object.entries(input.env ?? {})) {
          s().envSet.set(id, Object.keys(values))
        }
        const steps = [
          ...add.map((id) => ({
            provider: id,
            lines: id.startsWith("cli.")
              ? [`apt-get install -y ${id.slice(4)}`, "Unpacking…", "Setting up…", "done"]
              : id.startsWith("mcp.")
                ? [
                    `hermes mcp add ${id.slice(4)}`,
                    ...(input.env?.[id]
                      ? [`env: ${Object.keys(input.env[id] ?? {}).join(", ")} (stored encrypted)`]
                      : []),
                    "registered with Hermes",
                    "connected",
                  ]
                : [
                    `fetch ${id.slice(6)} @ pinned sha`,
                    `copied to ~/.hermes/skills/${id.slice(6)}`,
                  ],
          })),
          ...input.remove.map((id) => ({ provider: id, lines: [`removing ${id}`, "removed"] })),
        ]
        if (steps.length === 0) steps.push({ provider: "hermes", lines: ["nothing to change"] })
        if (add.length > 0 && !add.every((x) => x.startsWith("cli."))) {
          steps.push({
            provider: "hermes",
            lines: ["writing config.yaml", "graceful restart", "healthy"],
          })
        }
        const title = `Install ${add.length} · remove ${input.remove.length}`
        return startRun("apply", title, steps, () => {
          const st = s()
          const ids = new Set(selectionIds(st.installed))
          for (const id of add) ids.add(id)
          for (const id of input.remove) ids.delete(id)
          st.installed = toSelection([...ids])
          for (const id of add) {
            if (id === "cli.gh" || id === "cli.glab") {
              const cli = cliFor(id.slice(4) as "gh" | "glab")
              cli.installed = true
              cli.version = id === "cli.gh" ? "2.105.0" : "1.131.0"
            }
          }
        })
      }),
      connect: a.toolkit.connect.handler(({ input }) => {
        const item = byId.get(input.id)
        if (!item) throw new ORPCError("NOT_FOUND", { message: `Unknown item ${input.id}` })
        if (item.auth.type !== "oauth")
          throw new ORPCError("BAD_REQUEST", { message: `${item.name} does not use OAuth` })
        const flow: LoginFlow = {
          flowId: rid("flow"),
          url: `https://auth.example.org/authorize?client=${encodeURIComponent(item.id)}`,
          code: null,
          needsPaste: false,
          state: "waiting",
          message: "Finish signing in in the box browser",
          user: null,
        }
        s().flows.set(flow.flowId, {
          flow,
          kind: "oauth",
          pollsLeft: 3,
          pasted: true,
          item: item.id,
        })
        return flow
      }),
    },
    soul: {
      get: a.soul.get.handler(() => soul()),
      save: a.soul.save.handler(({ input }) => {
        s().soulUser = stripGenerated(input.markdown)
        return soul()
      }),
      regenerate: a.soul.regenerate.handler(async ({ input }) => {
        await sleep(input.ai ? 900 : 150)
        s().soulUser = soulUserDefault()
        if (input.ai) {
          s().soulUser = s().soulUser.replace(
            "# How you work",
            "# How you work\n- Prefer small, reviewable steps and say what you verified.",
          )
        }
        return soul()
      }),
    },
    clis: {
      status: a.clis.status.handler(() => [s().clis.gh, s().clis.glab]),
      authStart: a.clis.authStart.handler(({ input }) => {
        const cli = cliFor(input.cli)
        if (!cli.installed)
          throw new ORPCError("CONFLICT", { message: `${input.cli} is still being installed` })
        const flow: LoginFlow = {
          flowId: rid("flow"),
          url:
            input.cli === "gh"
              ? "https://github.com/login/device"
              : `https://${input.host ?? "gitlab.com"}/oauth/device`,
          code: input.cli === "gh" ? "7C2F-9B41" : "QX7K-M2PD",
          needsPaste: false,
          state: "waiting",
          message: null,
          user: null,
        }
        s().flows.set(flow.flowId, {
          flow,
          kind: input.cli,
          pollsLeft: 3,
          pasted: true,
          host: input.host,
        })
        return flow
      }),
      setToken: a.clis.setToken.handler(({ input }) => {
        const cli = cliFor(input.cli)
        Object.assign(cli, { authed: true, user: "token-user", host: input.host })
        return cli
      }),
    },
    git: {
      identity: a.git.identity.handler(() => s().git),
      setIdentity: a.git.setIdentity.handler(({ input }) => {
        s().git = input
        return input
      }),
    },
    ssh: {
      status: a.ssh.status.handler(() => s().ssh as never),
      generate: a.ssh.generate.handler(async () => {
        await sleep(300)
        s().ssh.publicKey =
          "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHkx3m0YcN7v1Q8pZb2rT9uWqL4sD6fG0hJ2kL8mN4pQ agentbox@agentbox-demo"
        s().ssh.fingerprint = "SHA256:q2Vf8mB1xZ0yK7rT3uW9pL5sD4fG6hJ8kN2mA1cE7bQ"
        return s().ssh as never
      }),
      register: a.ssh.register.handler(async ({ input }) => {
        await sleep(300)
        const cli = input.host === "github.com" ? s().clis.gh : s().clis.glab
        if (!cli.authed)
          throw new ORPCError("CONFLICT", {
            message: `Sign in with ${cli.id} first (step "Connect accounts")`,
          })
        s().ssh.registered[input.host] = true
        return s().ssh as never
      }),
    },
    repos: {
      list: a.repos.list.handler(async ({ input }) => {
        await sleep(200)
        const cli = input.host === "github.com" ? s().clis.gh : s().clis.glab
        if (!cli.authed) return []
        const owner = cli.user ?? "me"
        const names: [string, string | null, number, boolean][] = [
          ["agentbox", "Declarative agent workspaces on a single VM", 1, false],
          ["hermes-ui", "Web UI for the Hermes agent", 2, false],
          ["dotfiles", "My shell and editor setup", 5, true],
          ["paseo-mcp", "MCP server for Paseo", 9, false],
          ["blog", "Personal site", 30, false],
          ["advent-of-code", null, 300, false],
        ]
        return names.map(([name, description, days, priv]) => {
          const fullName = `${owner}/${name}`
          const sshUrl = `git@${input.host}:${fullName}.git`
          return {
            host: input.host,
            fullName,
            sshUrl,
            description,
            pushedAt: new Date(Date.now() - days * 86400_000).toISOString(),
            private: priv,
            cloned: s().cloned.has(sshUrl),
          }
        })
      }),
      local: a.repos.local.handler(() =>
        [...s().cloned].map((url) => {
          const m = /^git@([^:]+):(.+)\.git$/.exec(url)
          return {
            host: m?.[1] ?? "",
            fullName: m?.[2] ?? url,
            path: `/home/agentbox/work/${m?.[1]}/${m?.[2]}`,
          }
        }),
      ),
      clone: a.repos.clone.handler(({ input }) =>
        startRun(
          "apply",
          `Clone ${input.repos.length} repo${input.repos.length === 1 ? "" : "s"}`,
          input.repos.map((url) => ({
            provider: url.replace(/^git@[^:]+:/, "").replace(/\.git$/, ""),
            lines: [
              `git clone ${url}`,
              "Receiving objects: 100% (2048/2048), done.",
              "Resolving deltas: 100% (1024/1024), done.",
            ],
          })),
          () => {
            for (const url of input.repos) s().cloned.add(url)
          },
        ),
      ),
    },
    profiles: {
      list: a.profiles.list.handler(() => s().profiles),
      draft: a.profiles.draft.handler(async () => {
        await sleep(700)
        return {
          profiles: drafts(),
          source: s().ai.hermes.ready ? ("ai" as const) : ("template" as const),
        }
      }),
      create: a.profiles.create.handler(({ input }) => {
        if (s().profiles.some((p) => p.slug === input.slug))
          throw new ORPCError("CONFLICT", { message: `An agent called "${input.slug}" exists` })
        const p = {
          slug: input.slug,
          name: input.name,
          role: input.role,
          purpose: input.purpose,
          isDefault: false,
        }
        s().profiles.push(p)
        return p
      }),
      remove: a.profiles.remove.handler(({ input }) => {
        s().profiles = s().profiles.filter((p) => p.slug !== input.slug || p.isDefault)
        return { ok: true }
      }),
    },
    browser: {
      status: a.browser.status.handler(() => ({
        running: true,
        cdp: true,
        locked: s().browserLocked,
        path: "/browser/",
      })),
      setLock: a.browser.setLock.handler(({ input }) => {
        s().browserLocked = input.locked
        return { running: true, cdp: true, locked: input.locked, path: "/browser/" }
      }),
      open: a.browser.open.handler(() => ({ ok: true })),
    },
    devices: {
      list: a.devices.list.handler(() => s().devices),
      pairStart: a.devices.pairStart.handler(({ input }) => {
        const endpointId = "8f3c1a9e27b44d0f9e6a5b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e"
        const code = Array.from(
          { length: 8 },
          () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)],
        ).join("")
        const pwa = "https://maxgierlachowski.github.io/hermes-ui"
        s().pairing = {
          endpointId,
          code,
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          pwaLink: `${pwa}/#iroh=${endpointId}&pair=${code}&base=/hermes`,
          connectCommand: `agentbox connect ${endpointId} --code ${code}`,
        }
        void input
        return s().pairing as never
      }),
      revoke: a.devices.revoke.handler(({ input }) => {
        s().devices = s().devices.filter((d) => d.id !== input.id)
        return { ok: true }
      }),
    },
    runs: {
      list: a.runs.list.handler(({ input }) =>
        [...s().runs.values()]
          .map((r) => r.summary)
          .reverse()
          .slice(0, input.limit),
      ),
      get: a.runs.get.handler(({ input }) => {
        const r = s().runs.get(input.id)
        if (!r) throw new ORPCError("NOT_FOUND", { message: "Unknown run" })
        return r.summary
      }),
      cancel: a.runs.cancel.handler(({ input }) => {
        const r = s().runs.get(input.id)
        if (r && r.summary.status === "running") r.cancelled = true
        return { ok: true }
      }),
      events: a.runs.events.handler(async function* ({ input, lastEventId, signal }) {
        const r = s().runs.get(input.id)
        if (!r) throw new ORPCError("NOT_FOUND", { message: "Unknown run" })
        let next = lastEventId === undefined ? 0 : Number(lastEventId) + 1
        while (!signal?.aborted) {
          while (next < r.events.length) {
            const event = r.events[next] as RunEvent
            next++
            yield withEventMeta(event, { id: String(event.seq) })
            if (event.type === "run.finished") return
          }
          await sleep(80)
        }
      }),
    },
  })
}
