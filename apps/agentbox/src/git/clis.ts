import type { CliStatus, LoginFlow } from "@workspace/contract"
import { exec, which } from "../exec"
import type { FlowRegistry } from "../flows/flows"
import { ghParser, glabParser } from "../flows/parsers"
import type { RunService } from "../runs/service"

type CliId = "gh" | "glab"

const DEFAULT_HOST: Record<CliId, string> = { gh: "github.com", glab: "gitlab.com" }

/** gh and glab, authenticated by the service user; tokens stay in the CLIs' own stores. */
export class CliService {
  constructor(private readonly deps: { flows: FlowRegistry; runs: RunService; home: string }) {}

  private env() {
    return { HOME: this.deps.home, GH_PROMPT_DISABLED: undefined, NO_COLOR: "1" }
  }

  async version(cli: CliId) {
    if (!(await which(cli))) return null
    const r = await exec([cli, "--version"], { timeoutMs: 10_000 })
    return r.stdout.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null
  }

  async user(cli: CliId, host = DEFAULT_HOST[cli]): Promise<string | null> {
    if (!(await which(cli))) return null
    if (cli === "gh") {
      const r = await exec(["gh", "api", "--hostname", host, "user", "--jq", ".login"], {
        env: this.env(),
        timeoutMs: 20_000,
      })
      return r.code === 0 ? r.stdout.trim() || null : null
    }
    const r = await exec(["glab", "api", "--hostname", host, "user"], {
      env: this.env(),
      timeoutMs: 20_000,
    })
    if (r.code !== 0) return null
    try {
      return (JSON.parse(r.stdout) as { username?: string }).username ?? null
    } catch {
      return null
    }
  }

  async status(): Promise<CliStatus[]> {
    return Promise.all(
      (["gh", "glab"] as const).map(async (id) => {
        const version = await this.version(id)
        const user = version ? await this.user(id) : null
        return {
          id,
          installed: Boolean(version),
          version,
          authed: Boolean(user),
          user,
          host: DEFAULT_HOST[id],
        }
      }),
    )
  }

  async authStart(cli: CliId, host = DEFAULT_HOST[cli]): Promise<LoginFlow> {
    if (!(await which(cli))) throw new Error(`${cli} is not installed yet`)
    const verify = async () => {
      const user = await this.user(cli, host)
      if (!user) throw new Error(`${cli} finished, but is not signed in`)
      if (cli === "gh")
        await exec(["gh", "auth", "setup-git", "--hostname", host], { env: this.env() })
      return user
    }
    const argv =
      cli === "gh"
        ? // admin:public_key lets the SSH step upload the box's key; --skip-ssh-key avoids a prompt.
          [
            "gh",
            "auth",
            "login",
            "--web",
            "--git-protocol",
            "ssh",
            "--skip-ssh-key",
            "-s",
            "admin:public_key",
            "-h",
            host,
          ]
        : [
            "glab",
            "auth",
            "login",
            "--device",
            "--hostname",
            host,
            "--git-protocol",
            "ssh",
            // Without these glab stops at a TUI question; there is no keyring on a headless box.
            "--container-registry-domains",
            `${host},${host}:443,registry.${host}`,
            "--insecure-storage",
          ]
    const flow = this.deps.flows.start(argv, cli === "gh" ? ghParser(verify) : glabParser(verify), {
      env: this.env(),
    })
    return this.deps.flows.settleUntil(
      flow.flowId,
      (f) => Boolean(f.code) || f.state === "error",
      15_000,
    )
  }

  /** Personal access token fallback (token on stdin). */
  async setToken(cli: CliId, host: string, token: string): Promise<CliStatus> {
    this.deps.runs.addRedaction(token)
    const argv =
      cli === "gh"
        ? ["gh", "auth", "login", "--with-token", "-h", host, "--git-protocol", "ssh"]
        : ["glab", "auth", "login", "--stdin", "--hostname", host, "--git-protocol", "ssh"]
    const r = await exec(argv, { env: this.env(), stdin: `${token}\n`, timeoutMs: 30_000 })
    if (r.code !== 0) throw new Error(`${cli} rejected the token`)
    const user = await this.user(cli, host)
    return {
      id: cli,
      installed: true,
      version: await this.version(cli),
      authed: Boolean(user),
      user,
      host,
    }
  }
}
