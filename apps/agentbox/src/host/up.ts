import { existsSync, readFileSync, realpathSync } from "node:fs"
import { copyFile, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { type Artifact, CADDYFILE, COMPONENTS, HELPERS, SCRIPTS, UNITS } from "@workspace/providers"
import pc from "picocolors"
import pkg from "../../package.json" with { type: "json" }
import { CATALOG } from "../catalog/service"
import { accessBlock, writeFirstRun } from "../cli/first-run"
import { loadConfig } from "../config"
import { exec, execOk } from "../exec"
import { HermesFiles } from "../hermes/config"
import { releaseArtifacts } from "../release"
import {
  type Arch,
  asUser,
  asUserOk,
  debArch,
  networkFacts,
  osRelease,
  persistentSecret,
  SVC_HOME,
  sha256,
  systemctl,
  writeIfChanged,
} from "./system"

const STATE_FILE = "/var/lib/agentbox/up-state.json"
const ETC = "/etc/agentbox"
const PASEO_HOME = `${SVC_HOME}/.paseo`
const HERMES_HOME = `${SVC_HOME}/.hermes`
const PASEO_MCP_PORT = 6790
const BRIDGE_PORT = 8645

/** Standard Webhooks secret shared by paseo-mcp and the bridge (whsec_ + base64). */
async function bridgeWebhookSecret() {
  const raw = await persistentSecret(`${ETC}/secrets/bridge-webhook`, 32)
  return `whsec_${Buffer.from(raw).toString("base64")}`
}

type Outcome = "noop" | "changed"

interface Ctx {
  arch: Arch
  work: string
  state: Record<string, string>
  changed: string[]
  verbose: boolean
}

function loadState(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<string, string>
  } catch {
    return {}
  }
}

async function saveState(state: Record<string, string>) {
  await writeIfChanged(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}

async function step(ctx: Ctx, label: string, fn: () => Promise<Outcome>) {
  const started = Date.now()
  process.stdout.write(`  ${pc.dim("…")} ${label}`)
  try {
    const outcome = await fn()
    const secs = Math.round((Date.now() - started) / 1000)
    const note =
      outcome === "noop" ? pc.dim("noop") : pc.green(`done${secs >= 2 ? ` (${secs}s)` : ""}`)
    process.stdout.write(`\r  ${pc.green("✔")} ${label.padEnd(44)} ${note}\n`)
    if (outcome === "changed") ctx.changed.push(label)
  } catch (err) {
    process.stdout.write(`\r  ${pc.red("✖")} ${label}\n`)
    throw err
  }
}

/** Runs an embedded install script once per input set (stamp), unless its check fails. */
async function script(
  ctx: Ctx,
  key: string,
  name: keyof typeof SCRIPTS,
  args: string[],
  check?: () => Promise<boolean>,
  env: Record<string, string> = {},
): Promise<Outcome> {
  const stamp = sha256(`${SCRIPTS[name]}\n${args.join("\0")}\n${JSON.stringify(env)}`)
  if (ctx.state[key] === stamp && (!check || (await check()))) return "noop"
  const file = join(ctx.work, `${name}.sh`)
  await writeFile(file, SCRIPTS[name], { mode: 0o700 })
  const lines: string[] = []
  const r = await exec(["bash", file, ...args], {
    env: { ...env, DEBIAN_FRONTEND: "noninteractive" },
    timeoutMs: 45 * 60_000,
    onLine: (l) => {
      lines.push(l)
      if (ctx.verbose) process.stdout.write(`\n    ${pc.dim(l)}`)
    },
  })
  if (r.code !== 0) {
    const tail = lines.slice(-15).join("\n    ")
    throw new Error(`${name} install failed (exit ${r.code}):\n    ${tail}`)
  }
  ctx.state[key] = stamp
  await saveState(ctx.state)
  return "changed"
}

const binOk = async (argv: string[], match?: RegExp) => {
  const r = await exec(argv, { timeoutMs: 30_000 })
  return r.code === 0 && (!match || match.test(r.stdout + r.stderr))
}

// ---------------------------------------------------------------------------------------------

export async function up(opts: { listen: "auto" | "lan" | "local"; skipInstall: boolean }) {
  if (process.getuid?.() !== 0) throw new Error("Run as root: sudo agentbox up")
  const os = osRelease()
  if (os.id !== "ubuntu" || os.version !== "24.04")
    throw new Error(`agentbox supports Ubuntu 24.04 (this is ${os.pretty || "unknown"})`)
  if (!existsSync("/run/systemd/system")) throw new Error("systemd is required")
  const arch = debArch()
  const ctx: Ctx = {
    arch,
    work: await mkdtemp(join(tmpdir(), "agentbox-up-")),
    state: loadState(),
    changed: [],
    verbose: process.env.AGENTBOX_VERBOSE === "1",
  }
  console.log(`\n${pc.bold("agentbox up")} ${pkg.version} · ${os.pretty} · ${arch}\n`)
  try {
    if (!opts.skipInstall) await install(ctx)
    const net = await configure(ctx, opts.listen)
    await start(ctx)
    await finish(ctx, net)
  } finally {
    await rm(ctx.work, { recursive: true, force: true })
  }
}

// ---- 1. install ------------------------------------------------------------------------------

async function install(ctx: Ctx) {
  const C = COMPONENTS
  await step(ctx, "Base packages, users, directories", () => script(ctx, "base", "base", []))
  await step(ctx, `agentbox ${pkg.version}`, () => installSelf())
  await step(ctx, `Node.js ${C.node.version}`, () =>
    script(ctx, "node", "node", [C.node.version], () =>
      binOk(["/usr/local/bin/node", "--version"], new RegExp(C.node.version)),
    ),
  )
  await step(ctx, `Paseo ${C.paseo.version}`, () =>
    script(ctx, "paseo", "paseo", [C.paseo.version, "agentbox", PASEO_HOME], () =>
      binOk(["/usr/local/bin/paseo", "--version"]),
    ),
  )
  await step(ctx, `Claude Code ${C.claude.version}`, () =>
    script(ctx, "claude", "claude", [C.claude.version], () =>
      binOk(["/usr/local/bin/claude", "--version"], new RegExp(C.claude.version)),
    ),
  )
  for (const cli of ["gh", "glab"] as const) {
    const c = C[cli]
    await step(ctx, `${cli} ${c.version}`, () =>
      script(ctx, cli, "deb", [cli, c.version, c.url(ctx.arch), c.sha256[ctx.arch]]),
    )
  }
  await step(ctx, `Caddy ${C.caddy.version}`, () =>
    script(ctx, "caddy", "caddy", [], () => binOk(["/usr/local/bin/caddy", "version"])),
  )
  await step(ctx, `iroh gateway ${C.iroh.version}`, () =>
    script(ctx, "iroh", "iroh", [], () => binOk(["/usr/local/bin/iroh-gateway", "--version"])),
  )
  await step(ctx, `KasmVNC ${C.kasmvnc.version} (browser stream)`, () =>
    script(ctx, "kasmvnc", "kasmvnc", []),
  )
  await step(ctx, "Google Chrome", () =>
    script(ctx, "browser", "browser", [], () =>
      binOk(["/usr/local/bin/agentbox-chrome", "--version"]),
    ),
  )
  await step(ctx, `Hermes ${C.hermes.version} (takes a few minutes)`, () =>
    script(ctx, "hermes", "hermes", [C.hermes.version, "agentbox", HERMES_HOME], () =>
      binOk(["/usr/local/bin/hermes", "--version"]),
    ),
  )
  for (const a of releaseArtifacts())
    await step(ctx, `${a.name} ${a.version}`, () =>
      script(ctx, `artifact.${a.name}`, "tarball", [a.name, a.version, a.url, a.sha256], () =>
        Promise.resolve(existsSync(artifactDir(a))),
      ),
    )
  await step(ctx, "Helpers", async () => {
    let changed = false
    for (const [file, content] of Object.entries(HELPERS))
      changed =
        (await writeIfChanged(`/usr/local/lib/agentbox/${file}`, content, { mode: 0o755 })) ||
        changed
    const current = join("/opt/agentbox/vendor/hermes-agent", "current")
    if (
      !existsSync(current) ||
      (await readlink(current).catch(() => "")) !== COMPONENTS.hermes.version
    ) {
      await rm(current, { force: true })
      await symlink(COMPONENTS.hermes.version, current)
      changed = true
    }
    const accounts = artifact("paseo-multi-account")
    if (accounts) {
      const wrapper = `#!/bin/sh\n# paseo-multi-account CLI (agentbox wrapper)\nexport PASEO_HOME="\${PASEO_HOME:-${PASEO_HOME}}"\nexec /usr/local/bin/node ${artifactDir(accounts)}/bin/paseo-claude-accounts.mjs "$@"\n`
      changed =
        (await writeIfChanged("/usr/local/bin/paseo-claude-accounts", wrapper, { mode: 0o755 })) ||
        changed
    }
    return changed ? "changed" : "noop"
  })
}

const artifact = (name: Artifact["name"]) => releaseArtifacts().find((a) => a.name === name) ?? null
const artifactDir = (a: Artifact) => `/opt/agentbox/vendor/${a.name}/${a.version}/${a.dir}`

/** Copies the running binary to /opt/agentbox/releases/<v> and points /usr/local/bin/agentbox at it. */
async function installSelf(): Promise<Outcome> {
  const exe = realpathSync(process.execPath)
  const dir = `/opt/agentbox/releases/${pkg.version}`
  const target = `${dir}/agentbox`
  let changed = false
  if (
    exe !== target &&
    !(
      existsSync(target) &&
      sha256(readFileSync(target, "latin1")) === sha256(readFileSync(exe, "latin1"))
    )
  ) {
    await mkdir(dir, { recursive: true, mode: 0o755 })
    await copyFile(exe, `${target}.new`)
    await execOk(["chmod", "0755", `${target}.new`])
    await execOk(["mv", "-f", `${target}.new`, target])
    changed = true
  }
  for (const [link, to] of [
    ["/opt/agentbox/current", dir],
    ["/usr/local/bin/agentbox", "/opt/agentbox/current/agentbox"],
  ] as const) {
    if ((await readlink(link).catch(() => "")) !== to) {
      await rm(link, { force: true })
      await symlink(to, link)
      changed = true
    }
  }
  return changed ? "changed" : "noop"
}

// ---- 2. configure ----------------------------------------------------------------------------

interface Net {
  mode: "lan" | "local"
  ip: string | null
  lanUrl: string | null
  fingerprint: string | null
}

async function configure(ctx: Ctx, listen: "auto" | "lan" | "local"): Promise<Net> {
  const net = await networkFacts()
  const mode: Net["mode"] =
    listen === "auto" ? (net.hasPublic || !net.primary ? "local" : "lan") : listen
  const result: Net = {
    mode,
    ip: mode === "lan" ? net.primary : null,
    lanUrl: null,
    fingerprint: null,
  }
  if (mode === "lan" && !result.ip)
    throw new Error("No LAN address found; use --listen local and an SSH tunnel")

  await step(
    ctx,
    `Edge config (${mode === "lan" ? `LAN https://${result.ip}:8443` : "loopback only"})`,
    async () => {
      let changed = false
      const proxySecret = await persistentSecret(`${ETC}/secrets/proxy-secret`)
      changed =
        (await writeIfChanged(`${ETC}/proxy-secret`, `${proxySecret}\n`, {
          mode: 0o640,
          owner: "root",
          group: "agentbox",
        })) || changed
      changed =
        (await writeIfChanged(`${ETC}/env/caddy.env`, `AGENTBOX_PROXY_SECRET=${proxySecret}\n`, {
          mode: 0o600,
        })) || changed
      if (mode === "lan" && result.ip) {
        const tls = await ensureCert(result.ip)
        result.fingerprint = tls.fingerprint
        result.lanUrl = `https://${result.ip}:8443`
        changed = tls.changed || changed
      }
      const caddyfile =
        mode === "lan"
          ? CADDYFILE.replace(/^# @LAN_(BEGIN|END)@\n/gm, "")
          : CADDYFILE.replace(/^# @LAN_BEGIN@\n[\s\S]*?^# @LAN_END@\n/m, "")
      changed = (await writeIfChanged(`${ETC}/Caddyfile`, caddyfile, { mode: 0o644 })) || changed
      // `caddy validate` provisions the local CA dir: run it as the edge user.
      const v = await exec(
        [
          "runuser",
          "-u",
          "agentbox-edge",
          "--",
          "env",
          "HOME=/var/lib/agentbox/caddy",
          `AGENTBOX_PROXY_SECRET=x`,
          "/usr/local/bin/caddy",
          "validate",
          "--config",
          `${ETC}/Caddyfile`,
          "--adapter",
          "caddyfile",
        ],
        { cwd: "/" },
      )
      if (v.code !== 0)
        throw new Error(
          `Caddyfile invalid: ${(v.stderr || v.stdout).trim().split("\n").slice(-3).join(" ")}`,
        )
      const toml = [
        "# agentbox host config (written by `agentbox up`). Re-run `sudo agentbox up` after editing.",
        `listen = "${mode}"`,
        ...(result.lanUrl ? [`lan_url = "${result.lanUrl}"`] : []),
        ...(result.fingerprint ? [`cert_fingerprint = "${result.fingerprint}"`] : []),
        ...existingTomlExtras(),
        "",
      ].join("\n")
      changed =
        (await writeIfChanged(`${ETC}/config.toml`, toml, {
          mode: 0o640,
          owner: "root",
          group: "agentbox",
        })) || changed
      return changed ? "changed" : "noop"
    },
  )

  await step(ctx, "Services (systemd units, sudo helper)", async () => {
    let changed = false
    const hermesUi = artifact("hermes-ui")
    for (const [name, text] of Object.entries(UNITS)) {
      if (name === "agentbox-hermes-ui.service" && !hermesUi) continue
      const body = text.replaceAll("@HERMES_UI_DIR@", hermesUi ? artifactDir(hermesUi) : "")
      if (await writeIfChanged(`/etc/systemd/system/${name}`, body)) {
        changed = true
        ctx.state[`unit.${name}`] = "restart"
      }
    }
    const sudoers =
      "# agentbox: the service may run only the fixed `agentbox host apply` actions as root.\nagentbox ALL=(root) NOPASSWD: /usr/local/bin/agentbox host apply *\n"
    if (await writeIfChanged("/etc/sudoers.d/agentbox.new", sudoers, { mode: 0o440 })) {
      await execOk(["visudo", "-cf", "/etc/sudoers.d/agentbox.new"])
      changed = true
    }
    await execOk(["mv", "-f", "/etc/sudoers.d/agentbox.new", "/etc/sudoers.d/agentbox"])
    if (changed) await systemctl("daemon-reload")
    const units = Object.keys(UNITS).filter(
      (u) =>
        u !== "agentbox-iroh-reload.service" && (hermesUi || u !== "agentbox-hermes-ui.service"),
    )
    await systemctl("enable", "--quiet", ...units)
    await saveState(ctx.state)
    return changed ? "changed" : "noop"
  })
  return result
}

function existingTomlExtras() {
  // Keep user-set keys (pwa_url, [iroh], [e2e]) across re-renders.
  const file = `${ETC}/config.toml`
  if (!existsSync(file)) return []
  const text = readFileSync(file, "utf8")
  const keep: string[] = []
  let section = ""
  for (const line of text.split("\n")) {
    const s = line.match(/^\s*\[([^\]]+)\]/)?.[1]
    if (s) section = s
    if (section || /^\s*pwa_url\s*=/.test(line)) keep.push(line)
  }
  return keep.filter((l, i, all) => l.trim() || all[i - 1]?.trim())
}

/** Self-signed ECDSA certificate for the LAN listener; stable fingerprint, renewed if the IP changes. */
async function ensureCert(ip: string) {
  const dir = `${ETC}/tls`
  const cert = `${dir}/cert.pem`
  const key = `${dir}/key.pem`
  let changed = false
  const hasIp =
    existsSync(cert) &&
    (
      await exec(["openssl", "x509", "-in", cert, "-noout", "-ext", "subjectAltName"])
    ).stdout.includes(`IP Address:${ip}`)
  if (!hasIp) {
    await mkdir(dir, { recursive: true, mode: 0o755 })
    const host = hostname()
    await execOk([
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-days",
      "825",
      "-subj",
      `/CN=agentbox ${host}`,
      "-keyout",
      key,
      "-out",
      cert,
      "-addext",
      `subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost,DNS:${host},DNS:${host}.local`,
      "-addext",
      "extendedKeyUsage=serverAuth",
    ])
    changed = true
  }
  await execOk(["chown", "root:agentbox-edge", key, cert])
  await execOk(["chmod", "0640", key])
  await execOk(["chmod", "0644", cert])
  const fp =
    (await execOk(["openssl", "x509", "-in", cert, "-noout", "-fingerprint", "-sha256"])).stdout
      .split("=")[1]
      ?.trim() ?? null
  return { changed, fingerprint: fp }
}

// ---- 3. start and wire -----------------------------------------------------------------------

async function restartIfChanged(ctx: Ctx, unit: string) {
  const flagged = ctx.state[`unit.${unit}`] === "restart"
  const active = (await systemctl("is-active", "--quiet", unit)).code === 0
  if (!active || flagged) {
    await systemctl(active ? "restart" : "start", unit)
    delete ctx.state[`unit.${unit}`]
    await saveState(ctx.state)
    return true
  }
  return false
}

async function waitFor(what: string, fn: () => Promise<boolean>, ms = 90_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await fn().catch(() => false)) return
    await Bun.sleep(1000)
  }
  throw new Error(
    `${what} did not come up within ${Math.round(ms / 1000)}s (journalctl -u <unit> for details)`,
  )
}

const httpOk =
  (url: string, any = false) =>
  async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => null)
    return Boolean(res && (any || res.ok))
  }

async function start(ctx: Ctx) {
  const paseoMcp = artifact("paseo-mcp")
  const accounts = artifact("paseo-multi-account")
  const bridge = artifact("hermes-paseo-bridge")
  const hermesUi = artifact("hermes-ui")

  await step(ctx, "Firewall and edge", async () => {
    let changed = false
    for (const u of ["agentbox-firewall.service", "agentbox-caddy.service"])
      changed = (await restartIfChanged(ctx, u)) || changed
    await waitFor("Caddy", httpOk("http://127.0.0.1:8080/healthz"))
    return changed ? "changed" : "noop"
  })

  await step(ctx, "Paseo daemon and plugins", async () => {
    let changed = false
    // Plugins must be enabled before the daemon starts (a running daemon needs a restart).
    const p = await asUser([
      "/usr/local/bin/paseo",
      "daemon",
      "config",
      "get",
      "pluginsEnabled",
      "--home",
      PASEO_HOME,
    ])
    if (!/true/.test(p.stdout)) {
      await asUserOk([
        "/usr/local/bin/paseo",
        "daemon",
        "config",
        "set",
        "pluginsEnabled",
        "true",
        "--home",
        PASEO_HOME,
        "-q",
      ])
      ctx.state["unit.agentbox-paseo.service"] = "restart"
      changed = true
    }
    changed = (await restartIfChanged(ctx, "agentbox-paseo.service")) || changed
    await waitFor("Paseo", httpOk("http://127.0.0.1:6767/api/health"))
    await waitFor("Paseo daemon", async () =>
      /running/.test(
        (await asUser(["/usr/local/bin/paseo", "daemon", "status", "--home", PASEO_HOME])).stdout,
      ),
    )
    for (const [a, id] of [
      [paseoMcp, "paseo-mcp"],
      [accounts, "claude-accounts-usage"],
    ] as const) {
      if (!a) continue
      const key = `plugin.${id}`
      if (ctx.state[key] === a.sha256) continue
      await asUser(["/usr/local/bin/paseo", "plugin", "remove", id, "--home", PASEO_HOME])
      await asUserOk([
        "/usr/local/bin/paseo",
        "plugin",
        "install",
        artifactDir(a),
        "--home",
        PASEO_HOME,
      ])
      ctx.state[key] = a.sha256
      await saveState(ctx.state)
      changed = true
    }
    if (paseoMcp) changed = (await configurePaseoMcp(paseoMcp)) || changed
    return changed ? "changed" : "noop"
  })

  await step(ctx, "Hermes (config, MCP, bridge, skills)", async () => {
    let changed = false
    if (paseoMcp) changed = (await configureHermes(ctx, paseoMcp, bridge)) || changed
    changed = (await restartIfChanged(ctx, "agentbox-hermes.service")) || changed
    return changed ? "changed" : "noop"
  })

  await step(ctx, "Browser (KasmVNC + Chrome)", async () => {
    let changed = false
    for (const u of ["agentbox-kasmvnc.service", "agentbox-chrome.service"])
      changed = (await restartIfChanged(ctx, u)) || changed
    await waitFor("Chrome CDP", httpOk("http://127.0.0.1:9333/json/version"), 120_000)
    return changed ? "changed" : "noop"
  })

  await step(ctx, "agentbox, Hermes UI and iroh gateway", async () => {
    let changed = false
    const units = [
      "agentbox-config.service",
      "agentbox-iroh.service",
      "agentbox-iroh-reload.path",
      "agentbox.target",
    ]
    if (hermesUi) units.splice(1, 0, "agentbox-hermes-ui.service")
    for (const u of units) changed = (await restartIfChanged(ctx, u)) || changed
    await waitFor("agentbox API", httpOk("http://127.0.0.1:7777/healthz"))
    if (hermesUi) await waitFor("Hermes UI", httpOk("http://127.0.0.1:8787/api/health"))
    // /healthz answers 503 while no relay is reachable; any answer means the gateway runs.
    await waitFor("iroh gateway", httpOk("http://127.0.0.1:8090/healthz", true))
    return changed ? "changed" : "noop"
  })
}

/** paseo-mcp: HTTP endpoint on loopback, a token for Hermes UI, the bridge webhook, stdio config. */
async function configurePaseoMcp(a: Artifact) {
  let changed = false
  const token = await persistentSecret(`${ETC}/secrets/paseo-mcp-hermes-ui`)
  const hash = (
    await asUserOk(["/usr/local/bin/node", `${artifactDir(a)}/dist/admin.js`, "hash"], {
      stdin: token,
    })
  ).stdout.trim()
  const bridgeToken = await persistentSecret(`${ETC}/secrets/paseo-mcp-bridge`)
  const bridgeHash = (
    await asUserOk(["/usr/local/bin/node", `${artifactDir(a)}/dist/admin.js`, "hash"], {
      stdin: bridgeToken,
    })
  ).stdout.trim()
  const managed = {
    http: { enabled: true, port: PASEO_MCP_PORT, bind: "127.0.0.1" },
    tokens: [
      { id: "hermes-ui", label: "hermes-ui", scope: "full", origin: "hermes-ui", hash },
      // The bridge long-polls agent events of agents Hermes started.
      {
        id: "bridge",
        label: "hermes-paseo-bridge",
        scope: "read",
        labelFilter: { origin: "hermes" },
        hash: bridgeHash,
      },
    ],
    // Second intake: signed webhook to the bridge's loopback receiver (deduplicated with the long-poll).
    webhooks: [
      {
        id: "bridge-webhook",
        label: "hermes-paseo-bridge",
        url: `http://127.0.0.1:${BRIDGE_PORT}/paseo/events`,
        signature: "standard-webhooks",
        secret: await bridgeWebhookSecret(),
        types: ["agent.turn_ended", "agent.permission_requested", "agent.closed"],
        labels: { origin: "hermes" },
      },
    ],
    allowedRoots: [`${SVC_HOME}/work`],
    originLabel: "hermes",
  }
  changed =
    (await writeIfChanged(
      `${PASEO_HOME}/paseo-mcp.managed.json`,
      `${JSON.stringify(managed, null, 2)}\n`,
      { mode: 0o600, owner: "agentbox" },
    )) || changed
  const stdio = {
    daemonUrl: "ws://127.0.0.1:6767/ws",
    allowedRoots: [`${SVC_HOME}/work`],
    originLabel: "hermes",
    defaultProvider: "claude",
    events: { enabled: true },
  }
  changed =
    (await writeIfChanged(
      `${SVC_HOME}/.config/paseo-mcp/config.json`,
      `${JSON.stringify(stdio, null, 2)}\n`,
      { mode: 0o600, owner: "agentbox" },
    )) || changed
  const proxySecret = readFileSync(`${ETC}/proxy-secret`, "utf8").trim()
  const uiEnv = `HERMES_UI_PROXY_SECRET=${proxySecret}\nPASEO_MCP_TOKEN=${token}\n`
  if (await writeIfChanged(`${ETC}/env/hermes-ui.env`, uiEnv, { mode: 0o600 })) {
    changed = true
  }
  return changed
}

/** Hermes: the paseo MCP server, browser CDP, the bridge plugin and the agentbox skills. */
async function configureHermes(ctx: Ctx, paseoMcp: Artifact, bridge: Artifact | null) {
  let changed = false
  const files = new HermesFiles(HERMES_HOME)
  const paseoServer = {
    command: "/usr/local/bin/node",
    args: [`${artifactDir(paseoMcp)}/dist/index.js`],
    env: { PASEO_MCP_CONFIG: `${SVC_HOME}/.config/paseo-mcp/config.json`, PASEO_HOME },
    enabled: true,
  }
  if (JSON.stringify(files.mcpServers().paseo) !== JSON.stringify(paseoServer)) {
    await files.setMcpServer("paseo", paseoServer)
    changed = true
  }
  const hermes = (args: string[]) =>
    asUser(["/usr/local/bin/hermes", ...args], { env: { HERMES_HOME } })
  const settings: [string, string][] = [
    ["browser.cdp_url", "http://127.0.0.1:9333"],
    ["platforms.webhook.extra.host", "127.0.0.1"],
  ]
  for (const [k, v] of settings) {
    const cur = (await hermes(["config", "get", k])).stdout.trim()
    if (cur !== v) {
      const r = await hermes(["config", "set", k, v])
      if (r.code !== 0) await hermes(["config", "set", "--force", k, v])
      changed = true
    }
  }
  if (bridge) {
    const dest = `${HERMES_HOME}/plugins/hermes-paseo-bridge`
    if (ctx.state["bridge"] !== bridge.sha256) {
      await rm(dest, { recursive: true, force: true })
      await mkdir(`${HERMES_HOME}/plugins`, { recursive: true })
      await execOk(["cp", "-r", artifactDir(bridge), dest])
      await execOk(["chown", "-R", "agentbox:agentbox", `${HERMES_HOME}/plugins`])
      await hermes(["plugins", "enable", "hermes-paseo-bridge"])
      ctx.state["bridge"] = bridge.sha256
      changed = true
    }
    const settings = {
      allow_gateway_injection: true,
      settings: {
        listen_port: BRIDGE_PORT,
        paseo_mcp_url: `http://127.0.0.1:${PASEO_MCP_PORT}/mcp`,
        fallback: { mode: "home" },
      },
    }
    const entry = (files.readConfig().plugins as { entries?: Record<string, unknown> } | undefined)
      ?.entries?.["hermes-paseo-bridge"]
    if (JSON.stringify(entry) !== JSON.stringify(settings)) {
      await files.updateConfig((doc) =>
        doc.setIn(["plugins", "entries", "hermes-paseo-bridge"], doc.createNode(settings)),
      )
      changed = true
    }
    const env = {
      HERMES_PASEO_BRIDGE_SECRET: await bridgeWebhookSecret(),
      HERMES_PASEO_BRIDGE_PASEO_MCP_TOKEN: readFileSync(
        `${ETC}/secrets/paseo-mcp-bridge`,
        "utf8",
      ).trim(),
    }
    const current = existsSync(files.envPath) ? readFileSync(files.envPath, "utf8") : ""
    if (Object.entries(env).some(([k, v]) => !current.includes(`${k}=${v}`))) {
      await files.setEnv(env)
      changed = true
    }
  }
  // agentbox-* skills: the box operates itself through these.
  for (const [path, entries] of Object.entries(CATALOG.skills)) {
    const name = path.split("/").pop() as string
    for (const root of [
      `${HERMES_HOME}/skills/agentbox/${name}`,
      `${SVC_HOME}/.claude/skills/${name}`,
    ])
      for (const [rel, content] of Object.entries(entries))
        changed =
          (await writeIfChanged(join(root, rel), content, { mode: 0o644, owner: "agentbox" })) ||
          changed
  }
  await execOk([
    "chown",
    "-R",
    "agentbox:agentbox",
    HERMES_HOME,
    `${SVC_HOME}/.claude`,
    `${SVC_HOME}/.config`,
  ])
  if (changed) ctx.state["unit.agentbox-hermes.service"] = "restart"
  return changed
}

// ---- 4. finish --------------------------------------------------------------------------------

async function finish(ctx: Ctx, net: Net) {
  const config = loadConfig("production")
  const services = (await exec(["systemctl", "is-active", ...SERVICE_UNITS])).stdout
    .trim()
    .split("\n")
  const healthy = services.filter((s) => s === "active").length
  console.log("")
  const allGood = healthy === SERVICE_UNITS.length
  console.log(
    `${allGood ? pc.green("✔") : pc.yellow("!")} Agentbox is running (${healthy}/${SERVICE_UNITS.length} services healthy)${ctx.changed.length ? "" : pc.dim(" · noop")}`,
  )
  if (!allGood)
    console.log(pc.yellow("  Check `agentbox doctor` and `journalctl -u 'agentbox-*'`."))
  const token = existsSync("/run/agentbox/cli.token")
    ? readFileSync("/run/agentbox/cli.token", "utf8").trim()
    : null
  if (!token) return
  const claimed = await fetch("http://127.0.0.1:7777/api/setup/status")
    .then((r) => r.json() as Promise<{ claimed: boolean }>)
    .then((b) => b.claimed)
    .catch(() => false)
  if (claimed) {
    const where =
      net.lanUrl ?? "http://localhost:8080 (through `ssh -L 8080:127.0.0.1:8080 <you>@<vm>`)"
    console.log(`  Open:  ${pc.bold(where)}  ${pc.dim("(already claimed)")}\n`)
    return
  }
  const { apiClient } = await import("../cli/api")
  const otp = await apiClient(config).admin.issueOtp({ purpose: "claim" })
  const block = accessBlock(config, { ...otp, path: "/setup/" }, process.env.SUDO_USER || "<you>")
  console.log(`${block}\n`)
  await writeFirstRun("/var/lib/agentbox/first-run.txt", block)
}

export const SERVICE_UNITS = [
  "agentbox-config.service",
  "agentbox-caddy.service",
  "agentbox-iroh.service",
  "agentbox-hermes.service",
  "agentbox-hermes-ui.service",
  "agentbox-paseo.service",
  "agentbox-kasmvnc.service",
  "agentbox-chrome.service",
  "agentbox-firewall.service",
]
