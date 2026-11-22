#!/usr/bin/env bun
import { Command, Option } from "@commander-js/extra-typings"
import pc from "picocolors"
import pkg from "../package.json" with { type: "json" }
import { apiClient, callByName } from "./cli/api"
import { accessBlock } from "./cli/first-run"
import { loadConfig } from "./config"
import { log } from "./log"
import { startServer } from "./server/start"
import { resolveWebRoot } from "./web-root"

const program = new Command()
  .name("agentbox")
  .description("Your agent box: Hermes, Paseo and a shared browser on one VM, reachable over iroh")
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

const fail = (err: unknown) => {
  console.error(pc.red(`✖ ${(err as Error).message}`))
  process.exit(1)
}

program
  .command("up")
  .description("Install or repair everything on this host (idempotent; run as root)")
  .addOption(
    new Option("--listen <mode>", "lan: HTTPS on the LAN IP; local: loopback only (SSH tunnel)")
      .choices(["auto", "lan", "local"] as const)
      .default("auto" as const),
  )
  .option("--skip-install", "only render config and restart services")
  .action(async (opts) => {
    const { up } = await import("./host/up")
    await up({ listen: opts.listen, skipInstall: Boolean(opts.skipInstall) }).catch(fail)
  })

program
  .command("serve")
  .description("Run the agentbox API and config UI in the foreground (systemd runs this)")
  .action(() => serve("production"))

program
  .command("dev")
  .description("Run the API for development (UI via `next dev` on :3100)")
  .action(() => serve("development"))

program
  .command("otp")
  .description("Issue a new one-time code to claim this box (run as root)")
  .action(async () => {
    const config = loadConfig("production")
    try {
      const res = await apiClient(config).admin.issueOtp({ purpose: "claim" })
      console.log(`\n${accessBlock(config, { ...res, path: "/setup/" })}\n`)
    } catch (err) {
      fail(err)
    }
  })

program
  .command("reset-owner")
  .description("Issue a one-time code that lets the owner set a new password (run as root)")
  .action(async () => {
    const config = loadConfig("production")
    try {
      const res = await apiClient(config).admin.issueOtp({ purpose: "reset" })
      console.log(`\n${accessBlock(config, { ...res, path: "/reset/" })}\n`)
    } catch (err) {
      fail(err)
    }
  })

program
  .command("api")
  .description(
    'Call an agentbox API procedure, e.g. `agentbox api catalog.search --json \'{"q":"github"}\'`',
  )
  .argument("<procedure>", "dotted procedure name")
  .option("--json <input>", "input as JSON", "")
  .action(async (procedure, { json }) => {
    const config = loadConfig("production")
    try {
      const input = json ? JSON.parse(json) : undefined
      const out = await callByName(apiClient(config), procedure, input)
      console.log(JSON.stringify(out, null, 2))
    } catch (err) {
      fail(err)
    }
  })

program
  .command("doctor")
  .description("Check services, health endpoints and network exposure")
  .option("--json", "machine-readable output")
  .action(async ({ json }) => {
    const config = loadConfig("production")
    let checks: { id: string; level: string; message: string }[]
    try {
      checks = (await apiClient(config).system.doctor()).checks
    } catch (err) {
      checks = [
        {
          id: "service.config",
          level: "fail",
          message: `agentbox API not reachable: ${(err as Error).message}`,
        },
      ]
    }
    const failCount = checks.filter((c) => c.level === "fail").length
    if (json) console.log(JSON.stringify({ fail: failCount, checks }, null, 2))
    else
      for (const c of checks) {
        const icon =
          c.level === "ok" ? pc.green("✔") : c.level === "warn" ? pc.yellow("!") : pc.red("✖")
        console.log(`${icon} ${c.message}`)
      }
    process.exitCode = failCount ? 1 : 0
  })

const host = program
  .command("host")
  .description("Root-only host actions (used through sudo by the agentbox service)")
host
  .command("apply")
  .argument("<action>", "restart | cli")
  .argument("<target>", "unit id or CLI id")
  .action(async (action, target) => {
    const { hostApplyAction } = await import("./host/apply")
    await hostApplyAction(action, target).catch(fail)
  })

program
  .command("connect")
  .description("Reach your box from this laptop over iroh: pairs once, then serves it on localhost")
  .argument("[endpoint]", "the box's iroh endpoint id (from Devices → Pair)")
  .option("--code <code>", "pairing code (first time only)")
  .option("--port <port>", "local port", "8080")
  .option("--name <name>", "device name shown on the box")
  .action(async (endpoint, opts) => {
    const { connect } = await import("./connect/connect")
    await connect({ endpoint, code: opts.code, port: Number(opts.port), name: opts.name }).catch(
      fail,
    )
  })

await program.parseAsync()
