import { existsSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { writeFileAtomic } from "@workspace/infra/fs"

/**
 * Claude accounts are Paseo providers that extend `claude` with their own CLAUDE_CONFIG_DIR
 * (the contract paseo-multi-account reads):
 *   agents.providers.<id> = { extends: "claude", label, enabled, env: { CLAUDE_CONFIG_DIR } }
 */
export interface AccountEntry {
  id: string
  label: string
  enabled: boolean
  configDir: string
}

type Json = Record<string, unknown>

export const ACCOUNT_PREFIX = "claude-"

export function accountSlug(label: string, taken: string[]) {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "account"
  let id = `${ACCOUNT_PREFIX}${base}`
  for (let n = 2; taken.includes(id); n++) id = `${ACCOUNT_PREFIX}${base}-${n}`
  return id
}

export class PaseoConfig {
  constructor(
    readonly paseoHome: string,
    readonly accountsRoot: string,
  ) {}

  get file() {
    return join(this.paseoHome, "config.json")
  }

  read(): Json {
    if (!existsSync(this.file)) return {}
    return JSON.parse(readFileSync(this.file, "utf8")) as Json
  }

  async write(config: Json) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    await writeFileAtomic(this.file, `${JSON.stringify(config, null, 2)}\n`, 0o600)
  }

  accounts(): AccountEntry[] {
    const providers = ((this.read().agents as Json | undefined)?.providers ?? {}) as Record<
      string,
      Json
    >
    return Object.entries(providers)
      .filter(([, p]) => p.extends === "claude")
      .map(([id, p]) => ({
        id,
        label: String(p.label ?? id),
        enabled: p.enabled !== false,
        configDir: String(
          (p.env as Json | undefined)?.CLAUDE_CONFIG_DIR ?? join(this.accountsRoot, id),
        ),
      }))
  }

  async upsertAccount(entry: AccountEntry) {
    const config = this.read()
    const agents = (config.agents ?? {}) as Json
    const providers = (agents.providers ?? {}) as Record<string, Json>
    providers[entry.id] = {
      ...(providers[entry.id] ?? {}),
      extends: "claude",
      label: entry.label,
      enabled: entry.enabled,
      env: { ...((providers[entry.id]?.env as Json) ?? {}), CLAUDE_CONFIG_DIR: entry.configDir },
    }
    await this.write({ ...config, agents: { ...agents, providers } })
  }

  async removeAccount(id: string) {
    const config = this.read()
    const agents = (config.agents ?? {}) as Json
    const providers = { ...((agents.providers ?? {}) as Record<string, Json>) }
    delete providers[id]
    await this.write({ ...config, agents: { ...agents, providers } })
  }
}
