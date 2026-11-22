import { existsSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { openDb } from "@workspace/infra/db"
import { SecretStore } from "@workspace/infra/secrets"
import { AiService } from "../ai/service"
import { Auth, randomToken } from "../auth/auth"
import { BrowserService } from "../browser/service"
import { CatalogService } from "../catalog/service"
import { type Config, paths } from "../config"
import { DeviceService } from "../devices/service"
import { FlowRegistry } from "../flows/flows"
import { writeFileAtomic } from "../fs"
import { CliService } from "../git/clis"
import { GitService } from "../git/git"
import { Hermes } from "../hermes/hermes"
import { Kv } from "../kv"
import { log } from "../log"
import { OnboardingService } from "../onboarding/service"
import { PaseoConfig } from "../paseo/accounts"
import { ProfileService } from "../profiles/service"
import { RunService } from "../runs/service"
import type { Services } from "../services"
import { SoulService } from "../soul/service"
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

  const services: Services = {
    auth,
    secrets,
    runs,
    flows,
    devices,
    clis,
    system: new SystemService(config, new Date()),
    onboarding: new OnboardingService(kv),
    ai: new AiService({ flows, paseo, hermes, secrets, runs, kv }),
    catalog: new CatalogService(),
    toolkit: new ToolkitService(),
    soul: new SoulService(),
    git: new GitService({ home: config.home, work: p.work, runs, clis, kv }),
    profiles: new ProfileService(),
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
