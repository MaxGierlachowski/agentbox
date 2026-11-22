import { existsSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { openDb } from "@workspace/infra/db"
import { SecretStore } from "@workspace/infra/secrets"
import { AiService } from "../ai/service"
import { Auth, randomToken } from "../auth/auth"
import { BrowserService } from "../browser/service"
import { CATALOG, CatalogService } from "../catalog/service"
import { type Config, paths } from "../config"
import { DeviceService } from "../devices/service"
import { FlowRegistry } from "../flows/flows"
import { writeFileAtomic } from "../fs"
import { CliService } from "../git/clis"
import { GitService } from "../git/git"
import { HermesFiles } from "../hermes/config"
import { Hermes } from "../hermes/hermes"
import { Kv } from "../kv"
import { log } from "../log"
import { OnboardingService } from "../onboarding/service"
import { PaseoConfig } from "../paseo/accounts"
import { ProfileService } from "../profiles/service"
import { RunService } from "../runs/service"
import type { Services } from "../services"
import { boxHostname, SoulService, type SoulValues } from "../soul/service"
import { SystemService } from "../system/service"
import { ToolkitService } from "../toolkit/service"
import { createApp } from "./app"
import { createRouter } from "./router"

export async function startServer(config: Config, webRoot: string | null) {
  const p = paths(config)
  await mkdir(dirname(p.db), { recursive: true, mode: 0o750 })
  await mkdir(config.runtimeDir, { recursive: true, mode: 0o750 })

  const db = openDb(p.db)
  const kv = new Kv(db)
  const secrets = new SecretStore(p.secrets)
  await secrets.openUnattended()
  const runs = new RunService(db)
  runs.setRedactions(secrets.values())

  // The CLI authenticates against the local listener with this token (0640, agentbox group).
  const cliToken = randomToken()
  await writeFileAtomic(p.cliToken, cliToken, 0o640)

  const auth = new Auth(db, config, cliToken)
  const flows = new FlowRegistry()
  const hermes = new Hermes(p.hermesHome)
  const paseo = new PaseoConfig(p.paseoHome, p.claudeAccounts)
  const devices = new DeviceService(db, config)
  await devices
    .sync()
    .catch((err) => log.warn({ err: (err as Error).message }, "could not render iroh access"))
  const clis = new CliService({ flows, runs, home: config.home })

  const onboarding = new OnboardingService(kv)
  const files = new HermesFiles(p.hermesHome)
  const git = new GitService({ home: config.home, work: p.work, runs, clis, kv })
  // Late-bound so the catalog can ask the toolkit what is installed.
  let toolkit: ToolkitService | null = null
  const installed = () => toolkit?.installed() ?? new Set<string>()
  const catalog = new CatalogService(kv, installed)

  const soulValues = async (): Promise<SoulValues> => {
    const owner = auth.owner()
    const state = onboarding.get()
    const accounts = paseo.accounts()
    const cliStatus = await clis.status().catch(() => [])
    const identity = await git.identity().catch(() => null)
    const mcps = [...installed()]
      .filter((i) => i.startsWith("mcp."))
      .map((i) => catalog.item(i)?.name ?? i)
    return {
      "agent.name": "Hermes",
      "user.name": owner?.name ?? "the owner",
      "user.language": state.language,
      "user.timezone": state.timezone,
      "user.about": state.about,
      "user.roles": state.roles.join(", "),
      "box.hostname": boxHostname(),
      "paseo.accounts": accounts.map((a) => a.label).join(", "),
      "paseo.default":
        accounts.find((a) => a.id === kv.get<string>("ai.defaultAccount"))?.label ?? "",
      "repos.list": git
        .listLocal()
        .map((r) => r.fullName)
        .join(", "),
      "browser.sites": state.suggestedSites.map((u) => new URL(u).hostname).join(", "),
      "clis.authed": cliStatus
        .filter((c) => c.authed)
        .map((c) => `${c.id} (${c.user})`)
        .join(", "),
      "git.name": identity?.name ?? "",
      "git.email": identity?.email ?? "",
      "mcps.list": ["Paseo", ...mcps].join(", "),
      "delivery.home": kv.get<string>("delivery.home") ?? "none yet (connect Slack to get one)",
      "delivery.targets": "local files, this chat",
    }
  }
  // The default profile is the orchestrator; the user's roles shape the other profiles.
  const soul = new SoulService({
    hermesHome: p.hermesHome,
    templates: CATALOG.soul,
    values: soulValues,
    role: () => "orchestrator",
  })
  const profiles = new ProfileService({
    hermes,
    kv,
    catalog,
    soul,
    context: () => {
      const state = onboarding.get()
      return {
        roles: state.roles,
        about: state.about,
        installed: [...installed()],
        repos: git.listLocal().map((r) => r.fullName),
      }
    },
  })
  toolkit = new ToolkitService({
    catalog,
    hermes,
    files,
    runs,
    kv,
    secrets,
    flows,
    home: config.home,
    hermesSrc: "/opt/agentbox/vendor/hermes-agent/current",
    cacheDir: join(config.dataDir, "cache"),
    selection: () => onboarding.get().selection,
    afterChange: () => soul.refreshAll(profiles.slugs()),
  })

  const services: Services = {
    auth,
    secrets,
    runs,
    flows,
    devices,
    clis,
    onboarding,
    catalog,
    toolkit,
    soul,
    git,
    profiles,
    system: new SystemService(config, new Date()),
    ai: new AiService({ flows, paseo, hermes, secrets, runs, kv }),
    browser: new BrowserService(p.browserLock),
  }

  const proxySecret = () => {
    try {
      return existsSync(p.proxySecret) ? readFileSync(p.proxySecret, "utf8").trim() || null : null
    } catch {
      return null
    }
  }
  const router = createRouter(services)
  const app = createApp({ config, auth, router, devices, proxySecret, webRoot })

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: config.port,
    idleTimeout: 0, // long-lived SSE streams
    fetch: (req) => app.fetch(req),
  })
  log.info({ url: server.url.href }, "agentbox API ready")

  const stop = async () => {
    flows.stop()
    devices.stop()
    server.stop()
    secrets.seal()
  }
  return { stop, url: server.url.href, services }
}

export const cliTokenPath = (config: Config) => join(config.runtimeDir, "cli.token")
