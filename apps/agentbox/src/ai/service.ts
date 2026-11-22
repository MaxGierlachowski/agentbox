import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { AiStatus, ApiKeyProvider, LoginFlow } from "@workspace/contract"
import type { SecretStore } from "@workspace/infra/secrets"
import { exec } from "../exec"
import type { FlowRegistry } from "../flows/flows"
import { claudeParser } from "../flows/parsers"
import type { Hermes } from "../hermes/hermes"
import type { Kv } from "../kv"
import { log } from "../log"
import { accountSlug, type PaseoConfig } from "../paseo/accounts"
import type { RunService } from "../runs/service"

const CLAUDE_BIN = "/usr/local/bin/claude"
/** paseo-multi-account's CLI (wrapper installed by `agentbox up`); talks to the running daemon. */
const ACCOUNTS_BIN = "/usr/local/bin/paseo-claude-accounts"

/** Models offered in the Hermes model picker. Anything else can be set with `hermes config`. */
export const MODELS: Record<string, string[]> = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"],
  openai: ["gpt-5.5", "gpt-5.5-mini"],
  openrouter: ["anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "openai/gpt-5.5"],
}

interface HermesChoice {
  source: "claude-account" | "api-key"
  provider: string
  model: string
  account?: string
}

const KEY_CHECKS: Record<ApiKeyProvider, (key: string) => Promise<Response>> = {
  anthropic: (key) =>
    fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    }),
  openai: (key) =>
    fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } }),
  openrouter: (key) =>
    fetch("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key}` } }),
}

export class AiService {
  /** flowId → account being logged in. */
  private readonly pending = new Map<string, { id: string; label: string; dir: string }>()

  constructor(
    private readonly deps: {
      flows: FlowRegistry
      paseo: PaseoConfig
      hermes: Hermes
      secrets: SecretStore
      runs: RunService
      kv: Kv
    },
  ) {}

  private claudeEnv(dir: string) {
    return { CLAUDE_CONFIG_DIR: dir, DISABLE_AUTOUPDATER: "1" }
  }

  /** Reads `claude auth status`; tolerant to text or JSON output. */
  private async accountStatus(dir: string) {
    if (!existsSync(join(dir, ".credentials.json")))
      return { ready: false, email: null as string | null }
    const r = await exec([CLAUDE_BIN, "auth", "status"], {
      env: this.claudeEnv(dir),
      timeoutMs: 20_000,
    })
    const email = r.stdout.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null
    return { ready: r.code === 0, email }
  }

  async status(): Promise<AiStatus> {
    const defaultId = this.deps.kv.get<string>("ai.defaultAccount")
    const accounts = await Promise.all(
      this.deps.paseo.accounts().map(async (a) => {
        const s = await this.accountStatus(a.configDir).catch(() => ({ ready: false, email: null }))
        return {
          slug: a.id,
          label: a.label,
          status: s.ready ? ("ready" as const) : ("pending" as const),
          email: s.email,
          message: s.ready ? null : "Not signed in",
          isDefault: a.id === defaultId,
        }
      }),
    )
    const pending = []
    for (const [flowId, p] of this.pending) {
      let flow: LoginFlow
      try {
        flow = this.deps.flows.get(flowId)
      } catch {
        this.pending.delete(flowId) // expired
        continue
      }
      if (flow.state === "cancelled") {
        this.pending.delete(flowId)
        continue
      }
      pending.push({
        slug: p.id,
        label: p.label,
        status: flow.state === "error" ? ("error" as const) : ("pending" as const),
        email: null,
        message: flow.message,
        isDefault: false,
      })
    }
    const known = new Set(accounts.map((a) => a.slug))
    const apiKeys = (["anthropic", "openai", "openrouter"] as const).map((provider) => {
      const ref = `ai.${provider}_api_key`
      const set = !this.deps.secrets.sealed && this.deps.secrets.has(ref)
      return {
        provider,
        set,
        last4: set ? this.deps.secrets.reveal(ref).slice(-4) : null,
      }
    })
    const choice = this.deps.kv.get<HermesChoice>("ai.hermes")
    return {
      accounts: [...accounts, ...pending.filter((p) => !known.has(p.slug))],
      apiKeys,
      hermes: {
        source: choice?.source ?? "none",
        provider: choice?.provider ?? null,
        model: choice?.model ?? null,
        ready: this.deps.kv.get<boolean>("ai.hermesReady") === true,
        message: null,
      },
      models: MODELS,
    }
  }

  async accountLoginStart(label: string): Promise<LoginFlow> {
    const taken = [
      ...this.deps.paseo.accounts().map((a) => a.id),
      ...[...this.pending.values()].map((p) => p.id),
    ]
    const id = accountSlug(label, taken)
    const dir = join(this.deps.paseo.accountsRoot, id)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const flow = this.deps.flows.start(
      [CLAUDE_BIN, "auth", "login", "--claudeai"],
      claudeParser(async () => (await this.accountStatus(dir)).email),
      {
        env: this.claudeEnv(dir),
        onDone: async () => {
          await this.registerAccount(id, label, dir)
          this.pending.delete(flow.flowId)
        },
      },
    )
    this.pending.set(flow.flowId, { id, label, dir })
    // Give the CLI a moment to print the URL so the first response already carries it.
    return this.deps.flows.settleUntil(
      flow.flowId,
      (f) => Boolean(f.url) || f.state === "error",
      15_000,
    )
  }

  async accountLoginFinish(flowId: string, code: string) {
    // The pasted code goes to the PTY only; it never reaches logs.
    this.deps.runs.addRedaction(code.trim())
    this.deps.flows.write(flowId, `${code.trim()}\r`)
    return this.deps.flows.settle(flowId, 30_000)
  }

  private accountsCli(args: string[]) {
    return exec([ACCOUNTS_BIN, ...args], {
      env: { PASEO_HOME: this.deps.paseo.paseoHome, HOME: join(this.deps.paseo.paseoHome, "..") },
      timeoutMs: 60_000,
    })
  }

  /**
   * Registers the signed-in account with paseo-multi-account, which writes the provider entry
   * through the daemon (applied immediately). Falls back to editing config.json + reload.
   */
  private async registerAccount(id: string, label: string, dir: string) {
    const r = await this.accountsCli(["add", label, "--id", id, "--config-dir", dir])
    if (r.code !== 0) {
      log.warn(
        { account: id, err: (r.stderr || r.stdout).trim().slice(0, 300) },
        "plugin add failed, writing config",
      )
      await this.deps.paseo.upsertAccount({ id, label, enabled: false, configDir: dir })
      await exec(
        ["/usr/local/bin/paseo", "daemon", "reload", "--home", this.deps.paseo.paseoHome],
        { timeoutMs: 30_000 },
      )
    }
    if (!this.deps.kv.get<string>("ai.defaultAccount")) await this.accountSetDefault(id)
    log.info({ account: id }, "claude account added")
  }

  async accountRemove(slug: string) {
    const accounts = this.deps.paseo.accounts()
    const account = accounts.find((a) => a.id === slug)
    if (!account) return { ok: false, message: "Unknown account" }
    // The plugin refuses to remove the active account: switch away first.
    if (this.deps.kv.get<string>("ai.defaultAccount") === slug) {
      const other = accounts.find((a) => a.id !== slug)
      if (other) await this.accountSetDefault(other.id)
      else this.deps.kv.delete("ai.defaultAccount")
    }
    const r = await this.accountsCli(["remove", slug])
    if (r.code !== 0) await this.deps.paseo.removeAccount(slug)
    await rm(account.configDir, { recursive: true, force: true })
    return { ok: true }
  }

  /** Paseo agents use the active account (per-agent pinning is not supported by the plugin). */
  async accountSetDefault(slug: string) {
    if (!this.deps.paseo.accounts().some((a) => a.id === slug))
      return { ok: false, message: "Unknown account" }
    const r = await this.accountsCli(["switch", slug])
    if (r.code !== 0) return { ok: false, message: (r.stderr || r.stdout).trim().slice(0, 300) }
    this.deps.kv.set("ai.defaultAccount", slug)
    return { ok: true }
  }

  async setApiKey(provider: ApiKeyProvider, key: string) {
    const trimmed = key.trim()
    this.deps.runs.addRedaction(trimmed)
    const res = await KEY_CHECKS[provider](trimmed).catch(() => null)
    if (!res) return { ok: false, message: "Could not reach the provider to check the key" }
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: "The provider rejected this key" }
    await this.deps.secrets.set(`ai.${provider}_api_key`, trimmed, "api_key")
    this.deps.runs.setRedactions(this.deps.secrets.values())
    await this.deps.hermes.authAddApiKey(provider, trimmed)
    // Without a Claude subscription, Paseo's Claude Code agents use the API key.
    if (provider === "anthropic") await this.setPaseoClaudeKey(trimmed)
    return { ok: true, message: res.ok ? null : `Saved (provider answered ${res.status})` }
  }

  private async setPaseoClaudeKey(key: string | null) {
    await this.deps.paseo.setProviderEnv("claude", { ANTHROPIC_API_KEY: key })
    await exec(["/usr/local/bin/paseo", "daemon", "reload", "--home", this.deps.paseo.paseoHome], {
      timeoutMs: 30_000,
    })
  }

  async removeApiKey(provider: ApiKeyProvider) {
    if (provider === "anthropic") await this.setPaseoClaudeKey(null).catch(() => undefined)
    const deleted = await this.deps.secrets.delete(`ai.${provider}_api_key`)
    await this.deps.hermes.run(["auth", "remove", provider]).catch(() => null)
    return { ok: deleted }
  }

  async setHermesModel(choice: HermesChoice) {
    const h = this.deps.hermes
    // A Claude subscription for Hermes needs its own sign-in first (hermesLoginStart).
    if (
      choice.source === "claude-account" &&
      this.deps.kv.get<HermesChoice>("ai.hermes")?.source !== "claude-account"
    )
      throw new Error("Sign Hermes in with your Claude subscription first")
    await h.configSet("model.provider", choice.provider)
    await h.configSet("model.default", choice.model)
    this.deps.kv.set("ai.hermes", choice)
    this.deps.kv.set("ai.hermesReady", false)
    return this.status()
  }

  /** Hermes' own Anthropic OAuth (Claude subscription): URL + "Authorization code:" prompt. */
  async hermesLoginStart(model: string): Promise<LoginFlow> {
    const flow = this.deps.flows.start(
      ["/usr/local/bin/hermes", "auth", "add", "anthropic", "--type", "oauth", "--no-browser"],
      {
        parse: (out) => {
          const url = out.match(/(https:\/\/claude\.ai\/oauth\/authorize\?\S+)/)?.[1]
          return { url, needsPaste: Boolean(url) }
        },
      },
      {
        env: { HERMES_HOME: this.deps.hermes.home },
        onDone: async () => {
          await this.deps.hermes.configSet("model.provider", "anthropic")
          await this.deps.hermes.configSet("model.default", model)
          this.deps.kv.set("ai.hermes", { source: "claude-account", provider: "anthropic", model })
          this.deps.kv.set("ai.hermesReady", false)
        },
      },
    )
    return this.deps.flows.settleUntil(
      flow.flowId,
      (f) => Boolean(f.url) || f.state === "error",
      20_000,
    )
  }

  async probe() {
    try {
      const reply = await this.deps.hermes.chat(
        "Reply with the single word READY and nothing else.",
        {
          timeoutMs: 120_000,
        },
      )
      const ok = /READY/i.test(reply)
      this.deps.kv.set("ai.hermesReady", ok)
      return {
        ok,
        reply: reply.slice(-200),
        message: ok ? null : "Hermes answered, but not as expected",
      }
    } catch (err) {
      this.deps.kv.set("ai.hermesReady", false)
      return { ok: false, reply: null, message: (err as Error).message.slice(0, 400) }
    }
  }
}
