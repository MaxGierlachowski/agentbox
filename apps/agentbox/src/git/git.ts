import { existsSync, readdirSync, readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"
import type { RemoteRepo, SshStatus } from "@workspace/contract"
import { exec, execOk } from "../exec"
import type { Kv } from "../kv"
import type { RunService } from "../runs/service"
import type { CliService } from "./clis"

type GitHost = "github.com" | "gitlab.com"

/** `git@github.com:owner/repo.git` or `https://host/owner/repo(.git)` → host + owner/repo. */
export function parseRepoUrl(url: string) {
  const m =
    url.match(/^git@([^:]+):(.+?)(?:\.git)?$/) ??
    url.match(/^(?:ssh|https?):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/)
  if (!m) return null
  const [, host, fullName] = m as unknown as [string, string, string]
  if (
    !/^[\w.-]+(\/[\w.-]+)+$/.test(fullName) ||
    fullName.split("/").some((p) => p === ".." || p === ".")
  )
    return null
  return { host, fullName }
}

export class GitService {
  constructor(
    private readonly deps: {
      home: string
      work: string
      runs: RunService
      clis: CliService
      kv: Kv
    },
  ) {}

  private env() {
    return { HOME: this.deps.home }
  }

  private get sshDir() {
    return join(this.deps.home, ".ssh")
  }

  private get keyPath() {
    return join(this.sshDir, "id_ed25519")
  }

  async identity() {
    const name = (
      await exec(["git", "config", "--global", "user.name"], { env: this.env() })
    ).stdout.trim()
    const email = (
      await exec(["git", "config", "--global", "user.email"], { env: this.env() })
    ).stdout.trim()
    return name && email ? { name, email } : null
  }

  async setIdentity(id: { name: string; email: string }) {
    await execOk(["git", "config", "--global", "user.name", id.name], { env: this.env() })
    await execOk(["git", "config", "--global", "user.email", id.email], { env: this.env() })
    await execOk(["git", "config", "--global", "init.defaultBranch", "main"], { env: this.env() })
    return id
  }

  async sshStatus(): Promise<SshStatus> {
    const pubPath = `${this.keyPath}.pub`
    const publicKey = existsSync(pubPath) ? readFileSync(pubPath, "utf8").trim() : null
    let fingerprint: string | null = null
    if (publicKey) {
      const r = await exec(["ssh-keygen", "-lf", pubPath])
      fingerprint = r.stdout.split(" ")[1] ?? null
    }
    const registered = this.deps.kv.get<Record<GitHost, boolean>>("ssh.registered") ?? {
      "github.com": false,
      "gitlab.com": false,
    }
    return { publicKey, fingerprint, registered }
  }

  async sshGenerate() {
    await mkdir(this.sshDir, { recursive: true, mode: 0o700 })
    if (!existsSync(this.keyPath)) {
      await execOk([
        "ssh-keygen",
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        `agentbox@${hostname()}`,
        "-f",
        this.keyPath,
      ])
    }
    // First connection to a new host must not prompt (agents run unattended).
    const config = join(this.sshDir, "config")
    if (!existsSync(config))
      await writeFile(
        config,
        "Host *\n  StrictHostKeyChecking accept-new\n  IdentityFile ~/.ssh/id_ed25519\n",
        {
          mode: 0o600,
        },
      )
    return this.sshStatus()
  }

  async sshRegister(host: GitHost) {
    const status = await this.sshStatus()
    if (!status.publicKey) throw new Error("Generate a key first")
    const title = `agentbox ${hostname()}`
    const pub = `${this.keyPath}.pub`
    const argv =
      host === "github.com"
        ? ["gh", "ssh-key", "add", pub, "--title", title, "--type", "authentication"]
        : ["glab", "ssh-key", "add", pub, "--title", title]
    const r = await exec(argv, { env: this.env(), timeoutMs: 30_000 })
    // "already exists" counts as registered.
    if (r.code !== 0 && !/already|exists|taken/i.test(r.stdout + r.stderr))
      throw new Error(`Could not add the key: ${(r.stderr || r.stdout).trim().slice(0, 300)}`)
    this.deps.kv.set("ssh.registered", { ...status.registered, [host]: true })
    return this.sshStatus()
  }

  private cloned(host: string, fullName: string) {
    return existsSync(join(this.deps.work, host, fullName, ".git"))
  }

  async listRemote(host: GitHost): Promise<RemoteRepo[]> {
    if (host === "github.com") {
      const r = await execOk(
        [
          "gh",
          "api",
          "--paginate",
          "user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
        ],
        { env: this.env(), timeoutMs: 60_000 },
      )
      // --paginate concatenates JSON arrays: "][" between pages.
      const repos = JSON.parse(
        `[${r.stdout
          .trim()
          .replace(/\]\s*\[/g, ",")
          .replace(/^\[|\]$/g, "")}]`,
      ) as {
        full_name: string
        ssh_url: string
        description: string | null
        pushed_at: string | null
        private: boolean
      }[]
      return repos.slice(0, 300).map((x) => ({
        host,
        fullName: x.full_name,
        sshUrl: x.ssh_url,
        description: x.description,
        pushedAt: x.pushed_at,
        private: x.private,
        cloned: this.cloned(host, x.full_name),
      }))
    }
    const r = await execOk(
      ["glab", "api", "projects?membership=true&order_by=last_activity_at&per_page=100"],
      { env: this.env(), timeoutMs: 60_000 },
    )
    const repos = JSON.parse(r.stdout) as {
      path_with_namespace: string
      ssh_url_to_repo: string
      description: string | null
      last_activity_at: string | null
      visibility: string
    }[]
    return repos.map((x) => ({
      host,
      fullName: x.path_with_namespace,
      sshUrl: x.ssh_url_to_repo,
      description: x.description,
      pushedAt: x.last_activity_at,
      private: x.visibility !== "public",
      cloned: this.cloned(host, x.path_with_namespace),
    }))
  }

  listLocal() {
    const out: { path: string; fullName: string; host: string }[] = []
    if (!existsSync(this.deps.work)) return out
    const walk = (dir: string, depth: number) => {
      if (existsSync(join(dir, ".git"))) {
        const rel = dir.slice(this.deps.work.length + 1).split("/")
        out.push({ path: dir, host: rel[0] ?? "", fullName: rel.slice(1).join("/") })
        return
      }
      if (depth > 4) return
      for (const e of readdirSync(dir, { withFileTypes: true }))
        if (e.isDirectory() && !e.name.startsWith(".")) walk(join(dir, e.name), depth + 1)
    }
    walk(this.deps.work, 0)
    return out
  }

  clone(urls: string[], actor: string) {
    const parsed = urls.map((u) => ({ url: u, target: parseRepoUrl(u) }))
    const bad = parsed.find((p) => !p.target)
    if (bad) throw new Error(`Not a repository URL: ${bad.url}`)
    return this.deps.runs.start(
      `Clone ${urls.length} repositor${urls.length === 1 ? "y" : "ies"}`,
      actor,
      async (ctx) => {
        for (const { url, target } of parsed) {
          if (!target) continue
          const dir = join(this.deps.work, target.host, target.fullName)
          await ctx.step(target.fullName, async () => {
            if (existsSync(join(dir, ".git"))) {
              ctx.log("already cloned, fetching\n")
              await execOk(["git", "-C", dir, "fetch", "--all", "--prune"], {
                env: this.env(),
                signal: ctx.signal,
                onLine: (l, s) => ctx.log(`${l}\n`, s),
              })
              return
            }
            await mkdir(join(dir, ".."), { recursive: true })
            await execOk(["git", "clone", "--progress", url, dir], {
              env: { ...this.env(), GIT_TERMINAL_PROMPT: "0" },
              signal: ctx.signal,
              timeoutMs: 30 * 60_000,
              onLine: (l, s) => ctx.log(`${l}\n`, s),
            })
          })
        }
      },
    )
  }
}
