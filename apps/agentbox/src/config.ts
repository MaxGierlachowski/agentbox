import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

/** Public Hermes UI PWA used in phone pairing links (static, data-free). Configurable. */
export const DEFAULT_PWA_URL = "https://maxgierlachowski.github.io/hermes-ui/app"

export interface Config {
  mode: "production" | "development"
  /** agentbox state: SQLite, secrets, iroh state. */
  dataDir: string
  /** tmpfs: CLI token. */
  runtimeDir: string
  /** /etc/agentbox: config.toml, env files, TLS material. */
  etcDir: string
  /** Home of the service user: HERMES_HOME, PASEO_HOME, repos, CLI credentials. */
  home: string
  /** Local API listener (127.0.0.1 only). Caddy and the CLI talk to it. */
  port: number
  listen: "lan" | "local"
  lanUrl: string | null
  certFingerprint: string | null
  pwaUrl: string
  iroh: { relayUrl: string | null }
  /** Exposes `e2e.*` helpers; set only by the acceptance harness. */
  e2e: boolean
  /** Development only: identity assumed for local requests without a session. */
  devIdentity: string | null
}

interface FileConfig {
  listen?: "lan" | "local"
  lan_url?: string
  cert_fingerprint?: string
  pwa_url?: string
  iroh?: { relay_url?: string }
  e2e?: { enabled?: boolean }
}

function readFileConfig(etcDir: string): FileConfig {
  const file = join(etcDir, "config.toml")
  if (!existsSync(file)) return {}
  return Bun.TOML.parse(readFileSync(file, "utf8")) as FileConfig
}

export function loadConfig(mode: Config["mode"], overrides: Partial<Config> = {}): Config {
  const dev = mode === "development"
  const devRoot = resolve(process.env.AGENTBOX_DEV_ROOT ?? join(process.cwd(), ".agentbox-dev"))
  const etcDir = process.env.AGENTBOX_ETC_DIR ?? (dev ? join(devRoot, "etc") : "/etc/agentbox")
  const file = readFileConfig(etcDir)
  return {
    mode,
    dataDir: process.env.AGENTBOX_DATA_DIR ?? (dev ? join(devRoot, "data") : "/var/lib/agentbox"),
    runtimeDir: process.env.AGENTBOX_RUNTIME_DIR ?? (dev ? join(devRoot, "run") : "/run/agentbox"),
    etcDir,
    home: process.env.AGENTBOX_HOME ?? (dev ? join(devRoot, "home") : "/home/agentbox"),
    port: Number(process.env.AGENTBOX_PORT ?? 7777),
    listen: file.listen ?? "local",
    lanUrl: file.lan_url ?? null,
    certFingerprint: file.cert_fingerprint ?? null,
    pwaUrl: file.pwa_url ?? DEFAULT_PWA_URL,
    iroh: { relayUrl: file.iroh?.relay_url || null },
    e2e: file.e2e?.enabled === true,
    devIdentity: dev ? (process.env.AGENTBOX_DEV_IDENTITY ?? "dev@localhost") : null,
    ...overrides,
  }
}

export const paths = (c: Config) => ({
  db: join(c.dataDir, "state", "agentbox.db"),
  secrets: join(c.dataDir, "secrets"),
  cliToken: join(c.runtimeDir, "cli.token"),
  /** Shared with Caddy and Hermes UI through their env files; proves a request came via Caddy. */
  proxySecret: join(c.etcDir, "proxy-secret"),
  irohDir: join(c.dataDir, "iroh"),
  /** Rendered allow list for iroh-gateway; a systemd path unit reloads the gateway on change. */
  irohEnv: join(c.dataDir, "iroh-access", "access.env"),
  /** Cache of the gateway's endpoint id (read from its admin API). */
  irohEndpointId: join(c.dataDir, "state", "iroh-endpoint-id"),
  browserLock: join(c.dataDir, "browser.lock"),
  hermesHome: join(c.home, ".hermes"),
  paseoHome: join(c.home, ".paseo"),
  claudeAccounts: join(c.home, ".claude-accounts"),
  work: join(c.home, "work"),
  ssh: join(c.home, ".ssh"),
})
