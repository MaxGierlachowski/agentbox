import { existsSync } from "node:fs"
import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { CatalogItem, LoginFlow, RunSummary, Selection } from "@workspace/contract"
import type { SecretStore } from "@workspace/infra/secrets"
import type { CatalogService } from "../catalog/service"
import { exec, execOk } from "../exec"
import type { FlowRegistry } from "../flows/flows"
import type { HermesFiles } from "../hermes/config"
import type { Hermes } from "../hermes/hermes"
import { hostApply } from "../host/helper"
import type { Kv } from "../kv"
import type { JobContext, RunService } from "../runs/service"

const INSTALLED = "toolkit.installed"

/** Items agentbox manages itself during `agentbox up`; the toolkit never touches them. */
const CORE = new Set(["mcp.paseo", "cli.git"])

export interface ToolkitDeps {
  catalog: CatalogService
  hermes: Hermes
  files: HermesFiles
  runs: RunService
  kv: Kv
  secrets: SecretStore
  flows: FlowRegistry
  home: string
  /** Checked-out Hermes source of the pinned tag (optional-skills live there). */
  hermesSrc: string
  cacheDir: string
  /** Selected items from onboarding. */
  selection: () => Selection
  /** Called after changes so SOUL box facts stay current. */
  afterChange: () => Promise<void>
}

export const mcpName = (id: string) => id.replace(/^mcp\./, "").replace(/[^a-z0-9_-]/g, "-")
const secretRef = (id: string, env: string) =>
  `catalog.${id.replace(/^[a-z]+\./, "")}.${env.toLowerCase()}`

export class ToolkitService {
  constructor(private readonly d: ToolkitDeps) {}

  installed() {
    return new Set(this.d.kv.get<string[]>(INSTALLED) ?? [])
  }

  private markInstalled(ids: string[], removed: string[] = []) {
    const set = this.installed()
    for (const id of ids) set.add(id)
    for (const id of removed) set.delete(id)
    this.d.kv.set(INSTALLED, [...set].sort())
  }

  get(): { selection: Selection; installed: Selection } {
    const ids = [...this.installed()]
    return {
      selection: this.d.selection(),
      installed: {
        skills: ids.filter((i) => i.startsWith("skill.")),
        mcps: ids.filter((i) => i.startsWith("mcp.")),
        clis: ids.filter((i) => i.startsWith("cli.")),
      },
    }
  }

  apply(
    add: string[],
    remove: string[],
    actor: string,
    env: Record<string, Record<string, string>> = {},
  ): RunSummary {
    const unknown = [...add, ...remove].filter((id) => !this.d.catalog.item(id))
    if (unknown.length) throw new Error(`Unknown catalog items: ${unknown.join(", ")}`)
    const ids = this.d.catalog.withRequirements(add).filter((id) => !CORE.has(id))
    const items = ids.map((id) => this.d.catalog.item(id) as CatalogItem)
    const title =
      remove.length && !add.length
        ? `Remove ${remove.length} item(s)`
        : `Install ${ids.length} item(s)`
    return this.d.runs.start(title, actor, async (ctx) => {
      // Secrets the user entered: into the store first, so a retry doesn't need them again.
      for (const [id, vars] of Object.entries(env))
        for (const [name, value] of Object.entries(vars))
          if (value) await this.d.secrets.set(secretRef(id, name), value, "api_key")
      this.d.runs.setRedactions(this.d.secrets.values())

      let mcpChanged = false
      const order = { cli: 0, skill: 1, mcp: 2 } as const
      for (const item of [...items].sort((a, b) => order[a.kind] - order[b.kind])) {
        await ctx.step(item.name, async () => {
          if (item.kind === "cli") await this.installCli(item, ctx)
          else if (item.kind === "skill") await this.installSkill(item, ctx)
          else {
            await this.installMcp(item, ctx)
            mcpChanged = true
          }
          this.markInstalled([item.id])
        })
      }
      for (const id of remove.filter((r) => !CORE.has(r))) {
        const item = this.d.catalog.item(id)
        if (!item) continue
        await ctx.step(`Remove ${item.name}`, async () => {
          if (item.kind === "skill") await this.removeSkill(item)
          else if (item.kind === "mcp") {
            await this.d.files.removeMcpServer(mcpName(item.id))
            mcpChanged = true
          } else ctx.log("CLIs stay installed; remove them with apt if you no longer need them.\n")
          this.markInstalled([], [item.id])
        })
      }
      if (mcpChanged)
        await ctx.step("Restart Hermes", async () => {
          await hostApply({ action: "restart", unit: "hermes" }, (l) => ctx.log(`${l}\n`))
        })
      await this.d.afterChange().catch(() => undefined)
    })
  }

  // ---- CLIs ----------------------------------------------------------------------------------

  private async installCli(item: CatalogItem, ctx: JobContext) {
    if (!("cli" in item.install)) return
    await hostApply({ action: "cli", id: item.install.cli.plan }, (l) => ctx.log(`${l}\n`))
  }

  // ---- skills --------------------------------------------------------------------------------

  private skillTargets(item: CatalogItem, name: string, category: string) {
    const dirs = [join(this.d.files.home, "skills", category, name)]
    if (item.targets.includes("claude") || item.targets.includes("paseo"))
      dirs.push(join(this.d.home, ".claude", "skills", name))
    return dirs
  }

  private async installSkill(item: CatalogItem, ctx: JobContext) {
    if (!("skill" in item.install)) return
    const s = item.install.skill
    const name = basename(s.path)
    const category = s.category ?? (s.source === "agentbox" ? "agentbox" : "imported")
    if (s.source === "agentbox") {
      const files = this.d.catalog.data.skills[s.path]
      if (!files) throw new Error(`Skill files for ${item.id} are missing from this build`)
      for (const dir of this.skillTargets(item, name, category)) {
        for (const [rel, content] of Object.entries(files)) {
          await mkdir(dirname(join(dir, rel)), { recursive: true })
          await writeFile(join(dir, rel), content, { mode: 0o644 })
        }
      }
      ctx.log(`installed ${name}\n`)
      return
    }
    if (s.source === "hermes-builtin") {
      // Bundled skills (skills/…) are seeded by Hermes itself; optional ones are copied in.
      if (s.path.startsWith("skills/")) {
        ctx.log(`${name} ships with Hermes\n`)
        return
      }
      const src = join(this.d.hermesSrc, s.path)
      if (!existsSync(src)) throw new Error(`${s.path} not found in the installed Hermes`)
      for (const dir of this.skillTargets(item, name, category)) {
        await rm(dir, { recursive: true, force: true })
        await cp(src, dir, { recursive: true })
      }
      ctx.log(`installed ${name} from Hermes optional skills\n`)
      return
    }
    // git: shallow fetch of the pinned commit, then copy the folder.
    if (!s.repo || !s.sha) throw new Error(`${item.id}: git skill without repo/sha`)
    const checkout = join(this.d.cacheDir, "git", s.sha)
    if (!existsSync(join(checkout, s.path))) {
      await mkdir(checkout, { recursive: true })
      const git = (args: string[]) =>
        execOk(["git", "-C", checkout, ...args], {
          timeoutMs: 300_000,
          onLine: (l) => ctx.log(`${l}\n`),
        })
      if (!existsSync(join(checkout, ".git"))) {
        await git(["init", "-q"])
        await git(["remote", "add", "origin", s.repo])
      }
      await git(["fetch", "-q", "--depth", "1", "origin", s.sha])
      await git(["checkout", "-q", "FETCH_HEAD", "--", s.path])
    }
    for (const dir of this.skillTargets(item, name, category)) {
      await rm(dir, { recursive: true, force: true })
      await cp(join(checkout, s.path), dir, { recursive: true })
    }
    ctx.log(`installed ${name} @ ${s.sha.slice(0, 7)}\n`)
  }

  private async removeSkill(item: CatalogItem) {
    if (!("skill" in item.install)) return
    const s = item.install.skill
    if (s.source === "hermes-builtin" && s.path.startsWith("skills/")) return
    const name = basename(s.path)
    const category = s.category ?? (s.source === "agentbox" ? "agentbox" : "imported")
    for (const dir of this.skillTargets(item, name, category))
      await rm(dir, { recursive: true, force: true })
  }

  // ---- MCP servers ---------------------------------------------------------------------------

  /** Replaces `${NAME}` (item env) and `${gh.token}` with `${ENV}` references into Hermes' .env. */
  private async resolveTemplates(item: CatalogItem, values: string[]) {
    const env: Record<string, string> = {}
    for (const v of item.env) {
      const ref = secretRef(item.id, v.name)
      if (this.d.secrets.has(ref)) env[v.name] = this.d.secrets.reveal(ref)
      else if (v.required)
        throw new Error(`${item.name} needs ${v.name}. Enter it on the Connect accounts page.`)
    }
    for (const cli of ["gh", "glab"] as const) {
      if (!values.some((x) => x.includes(`\${${cli}.token}`))) continue
      const r = await exec([cli, "auth", "token"], {
        env: { HOME: this.d.home },
        timeoutMs: 15_000,
      })
      const token = r.stdout.trim()
      if (r.code !== 0 || !token)
        throw new Error(`${item.name} uses your ${cli} login: sign in to ${cli} first.`)
      this.d.runs.addRedaction(token)
      env[`AGENTBOX_${cli.toUpperCase()}_TOKEN`] = token
    }
    if (Object.keys(env).length) await this.d.files.setEnv(env)
    return (s: string) =>
      s.replace(
        /\$\{(gh|glab)\.token\}/g,
        (_m, cli: string) => `\${AGENTBOX_${cli.toUpperCase()}_TOKEN}`,
      )
  }

  private async installMcp(item: CatalogItem, ctx: JobContext) {
    if (!("mcp" in item.install)) return
    const m = item.install.mcp
    const strings =
      m.transport === "stdio"
        ? [m.command, ...m.args, ...Object.values(m.env ?? {})]
        : [m.url, ...Object.values(m.headers ?? {})]
    const fix = await this.resolveTemplates(item, strings)
    let server: Record<string, unknown>
    if (m.transport === "stdio") {
      const env: Record<string, string> = {}
      for (const [k, v] of Object.entries(m.env ?? {})) env[k] = fix(v)
      for (const v of item.env) if (!(v.name in env)) env[v.name] = `\${${v.name}}`
      server = {
        command: m.command,
        args: m.args.map(fix),
        ...(Object.keys(env).length ? { env } : {}),
        enabled: true,
      }
    } else {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(m.headers ?? {})) headers[k] = fix(v)
      server = {
        url: fix(m.url),
        ...(Object.keys(headers).length ? { headers } : {}),
        ...(item.auth.type === "oauth" ? { auth: "oauth" } : {}),
        enabled: true,
      }
    }
    await this.d.files.setMcpServer(mcpName(item.id), server)
    ctx.log(`added MCP server ${mcpName(item.id)} (${m.transport})\n`)
    if (item.auth.type === "oauth")
      ctx.log("Sign it in on the Connect accounts page (opens in the box browser).\n")
  }

  /** OAuth sign-in for an MCP server; the consent page opens in the box's Chrome. */
  async connect(id: string): Promise<LoginFlow> {
    const item = this.d.catalog.item(id)
    if (item?.kind !== "mcp") throw new Error("Not an MCP server")
    if (!this.installed().has(id)) throw new Error(`Install ${item.name} first`)
    const name = mcpName(id)
    const flow = this.d.flows.start(
      ["/usr/local/bin/hermes", "mcp", "login", name],
      {
        parse: (out) => ({ url: out.match(/(https:\/\/\S+)/)?.[1] }),
        autoAnswers: [{ match: /\[y\/N\]|\(y\/n\)/i, send: "y\r" }],
      },
      {
        env: {
          HERMES_HOME: this.d.files.home,
          HOME: this.d.home,
          // Python's webbrowser honours BROWSER: the URL opens in the box's Chrome via CDP.
          BROWSER: "/usr/local/lib/agentbox/open-url",
        },
        onDone: async () => {
          await hostApply({ action: "restart", unit: "hermes" }).catch(() => undefined)
        },
      },
    )
    return this.d.flows.settleUntil(
      flow.flowId,
      (f) => Boolean(f.url) || f.state !== "starting",
      10_000,
    )
  }
}
