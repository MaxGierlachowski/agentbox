import { join, resolve } from "node:path"

export interface Config {
  mode: "production" | "development"
  dataDir: string
  runtimeDir: string
  /** Local listener for the CLI and SSH tunnels. */
  port: number
  /** Unix socket that `tailscale serve` proxies to. Identity headers are trusted only here. */
  tailscaleSocket: string | null
  /** Tailscale logins allowed to use the UI. */
  allowedUsers: string[]
  /** Development only: identity assumed for local requests without a session. */
  devIdentity: string | null
}

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

export function loadConfig(mode: Config["mode"], overrides: Partial<Config> = {}): Config {
  const dev = mode === "development"
  const devRoot = resolve(process.env.AGENTBOX_DEV_ROOT ?? join(process.cwd(), ".agentbox-dev"))
  const dataDir = process.env.AGENTBOX_DATA_DIR ?? (dev ? join(devRoot, "data") : "/srv/agentbox")
  const runtimeDir =
    process.env.AGENTBOX_RUNTIME_DIR ?? (dev ? join(devRoot, "run") : "/run/agentbox")
  return {
    mode,
    dataDir,
    runtimeDir,
    port: Number(process.env.AGENTBOX_PORT ?? 7777),
    tailscaleSocket: join(runtimeDir, "web.sock"),
    allowedUsers: list(process.env.AGENTBOX_ALLOWED_USERS),
    devIdentity: dev ? (process.env.AGENTBOX_DEV_IDENTITY ?? "dev@localhost") : null,
    ...overrides,
  }
}

export const paths = (c: Config) => ({
  db: join(c.dataDir, "state", "agentbox.db"),
  secrets: join(c.dataDir, "secrets"),
  cliToken: join(c.runtimeDir, "cli.token"),
})
