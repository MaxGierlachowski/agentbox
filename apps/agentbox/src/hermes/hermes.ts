import { existsSync } from "node:fs"
import { join } from "node:path"
import { type ExecOptions, exec, execOk } from "../exec"

export const HERMES_BIN = "/usr/local/bin/hermes"

/**
 * Every Hermes change goes through this adapter (CLI verbs pinned to Hermes v0.23.3; see
 * docs/spikes/S2.md). Secrets are passed on stdin, never in argv.
 */
export class Hermes {
  constructor(readonly home: string) {}

  private env(extra: Record<string, string | undefined> = {}) {
    return { HERMES_HOME: this.home, HOME: join(this.home, ".."), NO_COLOR: "1", ...extra }
  }

  run(args: string[], opts: ExecOptions = {}) {
    return exec([HERMES_BIN, ...args], { ...opts, env: this.env(opts.env) })
  }

  runOk(args: string[], opts: ExecOptions = {}) {
    return execOk([HERMES_BIN, ...args], { ...opts, env: this.env(opts.env) })
  }

  installed() {
    return existsSync(HERMES_BIN)
  }

  configSet(key: string, value: string) {
    return this.runOk(["config", "set", key, value], { timeoutMs: 60_000 })
  }

  async configGet(key: string) {
    const r = await this.run(["config", "get", key], { timeoutMs: 60_000 })
    return r.code === 0 ? r.stdout.trim() : null
  }

  /** Registers an API key with Hermes' own credential store (key on stdin). */
  authAddApiKey(provider: string, key: string) {
    return this.runOk(["auth", "add", provider, "--type", "api-key"], {
      stdin: `${key}\n`,
      timeoutMs: 60_000,
    })
  }

  async mcpList() {
    const r = await this.run(["mcp", "list"], { timeoutMs: 60_000 })
    return r.stdout
  }

  mcpAddStdio(name: string, command: string, args: string[], env: Record<string, string> = {}) {
    const envArgs = Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`])
    return this.runOk(["mcp", "add", name, "--command", command, "--args", ...args, ...envArgs], {
      timeoutMs: 120_000,
    })
  }

  mcpAddHttp(name: string, url: string, auth?: "oauth" | "header") {
    return this.runOk(["mcp", "add", name, "--url", url, ...(auth ? ["--auth", auth] : [])], {
      timeoutMs: 120_000,
    })
  }

  mcpRemove(name: string) {
    return this.run(["mcp", "remove", name], { timeoutMs: 60_000 })
  }

  profileCreate(slug: string) {
    return this.runOk(["profile", "create", slug, "--no-alias"], { timeoutMs: 120_000 })
  }

  profileDelete(slug: string) {
    return this.run(["profile", "delete", slug, "--yes"], { timeoutMs: 60_000 })
  }

  pluginsEnable(id: string) {
    return this.runOk(["plugins", "enable", id], { timeoutMs: 60_000 })
  }

  /** One-shot prompt; returns the reply text. */
  async chat(prompt: string, opts: { profile?: string; timeoutMs?: number } = {}) {
    const args = [...(opts.profile ? ["-p", opts.profile] : []), "chat", "-q", prompt]
    const r = await this.runOk(args, { timeoutMs: opts.timeoutMs ?? 180_000 })
    return r.stdout.trim()
  }

  profileDir(slug: string | null) {
    return slug ? join(this.home, "profiles", slug) : this.home
  }
}
