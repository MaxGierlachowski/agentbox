import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { AiStatus, ApiKeyProvider, LoginFlow } from "@workspace/contract"
import type { SecretStore } from "@workspace/infra/secrets"
import { exec } from "../exec"
import type { FlowRegistry } from "../flows/flows"
import { claudeParser } from "../flows/parsers"
import type { Hermes } from "../hermes/hermes"
import { hostApply } from "../host/helper"
import type { Kv } from "../kv"
import { log } from "../log"
import { accountSlug, type PaseoConfig } from "../paseo/accounts"
import type { RunService } from "../runs/service"

const CLAUDE_BIN = "/usr/local/bin/claude"

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
    const pending = [...this.pending.entries()].map(([flowId, p]) => {
      const flow = this.deps.flows.get(flowId)
      return {
        slug: p.id,
        label: p.label,
        status: flow.state === "error" ? ("error" as const) : ("pending" as const),
        email: null,
        message: flow.message,
        isDefault: false,
      }
    })
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

  private async registerAccount(id: string, label: string, dir: string) {
    await this.deps.paseo.upsertAccount({ id, label, enabled: true, configDir: dir })
    if (!this.deps.kv.get<string>("ai.defaultAccount")) this.deps.kv.set("ai.defaultAccount", id)
    await this.reloadPaseo()
    log.info({ account: id }, "claude account added")
  }

  private async reloadPaseo() {
    // Paseo reads provider entries at start; restart it so the new account appears.
    await hostApply({ action: "restart", unit: "paseo" }).catch((err) =>
      log.warn({ err: (err as Error).message }, "paseo restart failed"),
    )
  }

  async accountRemove(slug: string) {
    const account = this.deps.paseo.accounts().find((a) => a.id === slug)
    if (!account) return { ok: false, message: "Unknown account" }
    await this.deps.paseo.removeAccount(slug)
    await rm(account.configDir, { recursive: true, force: true })
    if (this.deps.kv.get<string>("ai.defaultAccount") === slug)
      this.deps.kv.delete("ai.defaultAccount")
    await this.reloadPaseo()
    return { ok: true }
  }

  async accountSetDefault(slug: string) {
    if (!this.deps.paseo.accounts().some((a) => a.id === slug))
      return { ok: false, message: "Unknown account" }
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
    return { ok: true, message: res.ok ? null : `Saved (provider answered ${res.status})` }
  }

  async removeApiKey(provider: ApiKeyProvider) {
    const deleted = await this.deps.secrets.delete(`ai.${provider}_api_key`)
    await this.deps.hermes.run(["auth", "remove", provider]).catch(() => null)
    return { ok: deleted }
  }

  async setHermesModel(choice: HermesChoice) {
    const h = this.deps.hermes
    if (choice.source === "claude-account") {
      const account = this.deps.paseo
        .accounts()
        .find((a) => a.id === (choice.account ?? this.deps.kv.get("ai.defaultAccount")))
      if (!account) throw new Error("Add a Claude account first")
      await this.useClaudeAccountForHermes(account.configDir)
    }
    await h.configSet("model.provider", choice.provider)
    await h.configSet("model.default", choice.model)
    this.deps.kv.set("ai.hermes", choice)
    this.deps.kv.set("ai.hermesReady", false)
    return this.status()
  }

  /**
   * Hermes signs in to Anthropic with the same Claude subscription by reading the account's
   * Claude Code credentials (see docs/spikes/S2.md).
   */
  private async useClaudeAccountForHermes(configDir: string) {
    const r = await this.deps.hermes.run(
      ["auth", "add", "anthropic", "--type", "oauth", "--no-browser"],
      {
        env: { CLAUDE_CONFIG_DIR: configDir },
        timeoutMs: 30_000,
        stdin: "",
      },
    )
    if (r.code !== 0) log.warn({ code: r.code }, "hermes could not import the Claude account login")
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
