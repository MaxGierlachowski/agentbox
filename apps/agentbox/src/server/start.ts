import { chmod, mkdir, rm } from "node:fs/promises"
import { dirname } from "node:path"
import { openDb } from "@workspace/infra/db"
import { SecretStore } from "@workspace/infra/secrets"
import { AutomationService } from "../automation/service"
import { type Config, paths } from "../config"
import { writeFileAtomic } from "../fs"
import { log } from "../log"
import { RunService } from "../runs/service"
import { ToolsService } from "../tools/service"
import { createApp } from "./app"
import { Auth, randomToken } from "./auth"
import { createRouter } from "./router"

export async function startServer(config: Config, webRoot: string | null) {
  const p = paths(config)
  await mkdir(dirname(p.db), { recursive: true, mode: 0o750 })
  await mkdir(config.runtimeDir, { recursive: true, mode: 0o750 })

  const db = openDb(p.db)
  const secrets = new SecretStore(p.secrets)
  const runs = new RunService(db)

  // The CLI authenticates against the local listener with this token (0640, agentbox group).
  const cliToken = randomToken()
  await writeFileAtomic(p.cliToken, cliToken, 0o640)

  const auth = new Auth(db, config, cliToken)
  // TODO(P2.1): read the MagicDNS name from `tailscale status --json`.
  const tailnetHost = () => process.env.AGENTBOX_TAILNET_HOST ?? null
  const tools = new ToolsService(db, secrets, { workspace: "default", tailnetHost })
  const automation = new AutomationService(db, secrets, tools, { workspace: "default" })
  automation.start()
  const router = createRouter({ runs, secrets, tools, automation, startedAt: new Date() })
  const app = createApp({ config, auth, router, webRoot })

  const local = Bun.serve({
    hostname: "127.0.0.1",
    port: config.port,
    idleTimeout: 0, // long-lived SSE streams
    fetch: (req) => app.fetch(req, { listener: "local" }),
  })
  log.info({ url: local.url.href }, "local listener ready")

  let tailscale: ReturnType<typeof Bun.serve> | null = null
  if (config.tailscaleSocket) {
    await rm(config.tailscaleSocket, { force: true })
    tailscale = Bun.serve({
      unix: config.tailscaleSocket,
      fetch: (req) => app.fetch(req, { listener: "tailscale" }),
    })
    // Only root (tailscaled) and the agentbox user may connect: identity headers are trusted here.
    await chmod(config.tailscaleSocket, 0o600)
    log.info({ socket: config.tailscaleSocket }, "tailscale listener ready")
  }

  if (config.allowedUsers.length === 0 && config.mode === "production") {
    log.warn("AGENTBOX_ALLOWED_USERS is empty: nobody can log in through Tailscale")
  }

  const stop = async () => {
    automation.stop()
    local.stop()
    tailscale?.stop()
    secrets.seal()
    await rm(p.cliToken, { force: true })
  }
  return { stop, url: local.url.href }
}
