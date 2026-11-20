#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings"
import { openDb } from "@workspace/infra/db"
import { createDocker, dockerFacts } from "@workspace/infra/docker"
import pc from "picocolors"
import pkg from "../package.json" with { type: "json" }
import { loadConfig, paths } from "./config"
import { log } from "./log"
import { Auth } from "./server/auth"
import { startServer } from "./server/start"
import { resolveWebRoot } from "./web-root"

const program = new Command()
  .name("agentbox")
  .description("Declarative agent workspaces on a single VM")
  .version(pkg.version)

async function serve(mode: "production" | "development") {
  const config = loadConfig(mode)
  const webRoot = mode === "development" ? null : resolveWebRoot()
  if (mode === "production" && !webRoot) log.warn("no embedded UI found, serving API only")
  const server = await startServer(config, webRoot)
  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down")
    await server.stop()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
}

program
  .command("up")
  .description("Run the agentbox service in the foreground (systemd uses this)")
  .action(() => serve("production"))

program
  .command("dev")
  .description("Run the service for development (UI via `next dev` on :3100)")
  .action(() => serve("development"))

program
  .command("login-link")
  .description("Print a one-time browser login link for access through an SSH tunnel")
  .option("--dev", "use the development data directory")
  .option("--login <login>", "identity recorded for the session", process.env.USER ?? "admin")
  .action(({ dev, login }) => {
    const config = loadConfig(dev ? "development" : "production")
    const auth = new Auth(openDb(paths(config).db), config, "")
    const token = auth.createLoginLink(login)
    const port = dev ? 3100 : config.port
    console.log(`\n  ${pc.bold("Login link")} ${pc.dim("(valid 5 minutes, single use)")}\n`)
    console.log(`  http://127.0.0.1:${port}/auth/link?token=${token}\n`)
    if (!dev) console.log(pc.dim(`  From your laptop: ssh -L ${port}:127.0.0.1:${port} <vm>\n`))
  })

program
  .command("doctor")
  .description("Check the host prerequisites agentbox depends on")
  .option("--json", "machine-readable output")
  .action(async ({ json }) => {
    const docker = await dockerFacts(createDocker())
    const webRoot = resolveWebRoot()
    const checks = [
      {
        id: "docker",
        ok: docker.reachable,
        message: docker.reachable
          ? `Docker ${docker.serverVersion} (API ${docker.apiVersion})`
          : `Docker not reachable: ${docker.error}`,
      },
      {
        id: "ui",
        ok: Boolean(webRoot),
        message: webRoot ? `UI assets at ${webRoot}` : "UI assets missing",
      },
      {
        id: "runtime",
        ok: true,
        message: `Bun ${Bun.version} on ${process.platform}/${process.arch}`,
      },
    ]
    if (json) console.log(JSON.stringify(checks, null, 2))
    else
      for (const c of checks)
        console.log(`${c.ok ? pc.green("✔") : pc.red("✖")} ${c.id.padEnd(8)} ${c.message}`)
    process.exitCode = checks.every((c) => c.ok) ? 0 : 1
  })

await program.parseAsync()
