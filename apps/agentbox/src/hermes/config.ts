import { existsSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { writeFileAtomic } from "@workspace/infra/fs"
import { parseDocument } from "yaml"

/**
 * Direct edits of Hermes' config.yaml and .env for things the CLI can't express without
 * putting secrets in argv (MCP headers/env). Comments and unknown keys survive.
 * Hermes resolves `${NAME}` in config.yaml from HERMES_HOME/.env.
 */
export class HermesFiles {
  constructor(readonly home: string) {}

  get configPath() {
    return join(this.home, "config.yaml")
  }

  get envPath() {
    return join(this.home, ".env")
  }

  async updateConfig(fn: (doc: ReturnType<typeof parseDocument>) => void) {
    const text = existsSync(this.configPath) ? readFileSync(this.configPath, "utf8") : ""
    const doc = parseDocument(text.trim() ? text : "{}\n")
    fn(doc)
    await mkdir(dirname(this.configPath), { recursive: true })
    await writeFileAtomic(this.configPath, doc.toString(), 0o600)
  }

  readConfig(): Record<string, unknown> {
    if (!existsSync(this.configPath)) return {}
    return (parseDocument(readFileSync(this.configPath, "utf8")).toJS() ?? {}) as Record<
      string,
      unknown
    >
  }

  mcpServers(): Record<string, Record<string, unknown>> {
    return (this.readConfig().mcp_servers ?? {}) as Record<string, Record<string, unknown>>
  }

  async setMcpServer(name: string, server: Record<string, unknown>) {
    await this.updateConfig((doc) => doc.setIn(["mcp_servers", name], doc.createNode(server)))
  }

  async removeMcpServer(name: string) {
    await this.updateConfig((doc) => {
      if (doc.hasIn(["mcp_servers", name])) doc.deleteIn(["mcp_servers", name])
    })
  }

  /** Sets KEY=value lines in .env (0600), keeping everything else. */
  async setEnv(values: Record<string, string>) {
    const lines = existsSync(this.envPath) ? readFileSync(this.envPath, "utf8").split("\n") : []
    const keys = new Set(Object.keys(values))
    const kept = lines.filter((l) => {
      const k = l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1]
      return !(k && keys.has(k))
    })
    while (kept.length && kept.at(-1) === "") kept.pop()
    for (const [k, v] of Object.entries(values)) kept.push(`${k}=${quoteEnv(v)}`)
    await mkdir(dirname(this.envPath), { recursive: true })
    await writeFileAtomic(this.envPath, `${kept.join("\n")}\n`, 0o600)
  }
}

export function quoteEnv(v: string) {
  if (/^[A-Za-z0-9_./:@+-]*$/.test(v)) return v
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\$/g, "\\$")}"`
}
