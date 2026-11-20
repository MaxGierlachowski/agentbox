import { Http, HttpError, readSse } from "../shared/http"

export const CLOUDCLI_PORT = 3001
export const CLOUDCLI_VERSION = "1.37.4"

/** Secrets agentbox generates and keeps in the age store. */
export const CLOUDCLI_SECRETS = { jwt: "cloudcli.jwt_secret", apiKey: "cloudcli.api_key" } as const

/**
 * Dockerfile layer for the workspace image (root, before `USER agent`). Needs Node >= 22 on PATH
 * (mise). Native modules (node-pty, better-sqlite3, bcrypt) need a compiler toolchain.
 */
export function cloudcliDockerfile(version = CLOUDCLI_VERSION): string[] {
  return [
    "# --- cloudcli: web UI for Claude Code sessions",
    "RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\",
    "    --mount=type=cache,target=/var/lib/apt,sharing=locked \\",
    "    apt-get update && apt-get install -y --no-install-recommends build-essential python3 python3-setuptools",
    `RUN npm install -g --no-fund --no-audit @cloudcli-ai/cloudcli@${version}`,
  ]
}

export interface WorkspaceServiceOptions {
  workspace: string
  image: string
  homeDir: string
  reposDir: string
  /** tmpfs env file: JWT_SECRET, CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY, GH_TOKEN. */
  secretEnvFile: string
}

/** The workspace container runs CloudCLI as its long-lived process. Loopback only. */
export function workspaceComposeService(o: WorkspaceServiceOptions) {
  return {
    image: o.image,
    restart: "unless-stopped",
    init: true,
    user: "10001:10001",
    working_dir: "/workspaces",
    command: ["cloudcli", "start", "--port", String(CLOUDCLI_PORT)],
    environment: {
      HOME: "/home/agent",
      HOST: "0.0.0.0", // inside the container; only 127.0.0.1 is published
      SERVER_PORT: String(CLOUDCLI_PORT),
      WORKSPACES_ROOT: "/workspaces",
      DATABASE_PATH: "/home/agent/.cloudcli/auth.db",
      DISABLE_AUTOUPDATER: "1",
      // API_KEY stays unset on purpose: it would require x-api-key on every /api call, which
      // the CloudCLI frontend never sends.
    },
    env_file: [o.secretEnvFile],
    ports: [`127.0.0.1:${CLOUDCLI_PORT}:${CLOUDCLI_PORT}`],
    volumes: [`${o.homeDir}:/home/agent`, `${o.reposDir}:/workspaces`],
    shm_size: "1gb",
    healthcheck: {
      test: ["CMD", "curl", "-fsS", `http://127.0.0.1:${CLOUDCLI_PORT}/api/auth/status`],
      interval: "10s",
      timeout: "5s",
      retries: 30,
      start_period: "30s",
    },
    labels: { "dev.agentbox.workspace": o.workspace, "dev.agentbox.provider": "cloudcli" },
  }
}

export interface CloudCliAdmin {
  username: string
  password: string
}

export class CloudCliClient {
  readonly http: Http
  private token: string | null = null

  constructor(
    readonly baseUrl: string,
    fetchImpl?: typeof fetch,
  ) {
    this.http = new Http({ baseUrl, fetch: fetchImpl })
  }

  needsSetup() {
    return this.http
      .json<{ needsSetup: boolean }>("GET", "/api/auth/status")
      .then((s) => s.needsSetup)
  }

  async register(admin: CloudCliAdmin) {
    const res = await this.http.json<{ token: string }>("POST", "/api/auth/register", {
      body: admin,
    })
    this.token = res.token
  }

  async login(admin: CloudCliAdmin) {
    const res = await this.http.json<{ token: string }>("POST", "/api/auth/login", { body: admin })
    this.token = res.token
  }

  private authed() {
    if (!this.token) throw new Error("CloudCLI: not logged in")
    return { authorization: `Bearer ${this.token}` }
  }

  async createApiKey(name: string): Promise<string> {
    const res = await this.http.json<{ apiKey: unknown }>("POST", "/api/settings/api-keys", {
      body: { keyName: name },
      headers: this.authed(),
    })
    const key =
      typeof res.apiKey === "string"
        ? res.apiKey
        : (res.apiKey as { apiKey?: string; key?: string })
    const value = typeof key === "string" ? key : (key?.apiKey ?? key?.key)
    if (!value?.startsWith("ck_")) throw new Error("CloudCLI: unexpected API key response")
    return value
  }

  async ensureProject(path: string, name?: string) {
    const projects = await this.http.json<unknown>("GET", "/api/projects", {
      headers: this.authed(),
    })
    if (JSON.stringify(projects).includes(`"${path}"`)) return false
    await this.http.json("POST", "/api/projects/create-project", {
      body: { path, customName: name },
      headers: this.authed(),
    })
    return true
  }
}

/**
 * Bootstraps CloudCLI: registers the single user (which closes registration for good) or logs
 * in, then creates the automation API key unless one is already stored.
 */
export async function bootstrapCloudCli(
  client: CloudCliClient,
  admin: CloudCliAdmin,
  opts: { existingApiKey?: string; projects: { path: string; name: string }[] },
) {
  const fresh = await client.needsSetup()
  if (fresh) await client.register(admin)
  else {
    try {
      await client.login(admin)
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        throw new Error(
          `CloudCLI is already set up with a different user than "${admin.username}". Reset its database or use those credentials.`,
        )
      }
      throw err
    }
  }
  const apiKey = opts.existingApiKey ?? (await client.createApiKey("agentbox-automation"))
  let projectsCreated = 0
  for (const p of opts.projects) if (await client.ensureProject(p.path, p.name)) projectsCreated++
  return { registered: fresh, apiKey, apiKeyCreated: !opts.existingApiKey, projectsCreated }
}

// --- Agent runs ----------------------------------------------------------------------------

export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "complete"; aborted: boolean }
  | { type: "error"; message: string }

export interface AgentRunRequest {
  projectPath: string
  message: string
  model?: string
  sessionId?: string
}

/** Starts a Claude Code session through CloudCLI's automation API and streams its events. */
export async function* runAgent(
  opts: { baseUrl: string; apiKey: string; fetch?: typeof fetch; signal?: AbortSignal },
  req: AgentRunRequest,
): AsyncGenerator<AgentEvent> {
  const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}/api/agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      accept: "text/event-stream",
    },
    body: JSON.stringify({ ...req, provider: "claude", stream: true }),
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "")
    yield {
      type: "error",
      message: `CloudCLI /api/agent returned HTTP ${res.status}: ${text.slice(0, 300)}`,
    }
    return
  }
  for await (const raw of readSse(res.body, opts.signal)) {
    if (!raw || typeof raw !== "object") continue
    const e = raw as Record<string, unknown>
    if (e.type === "session-id" && typeof e.sessionId === "string")
      yield { type: "session", sessionId: e.sessionId }
    else if (e.type === "error")
      yield { type: "error", message: String(e.error ?? e.message ?? "unknown error") }
    else if (e.kind === "text" && e.role !== "user" && typeof e.content === "string")
      yield { type: "text", text: e.content }
    else if (e.kind === "tool_use")
      yield { type: "tool", name: String(e.toolName ?? e.name ?? "tool") }
    else if (e.kind === "error")
      yield { type: "error", message: String(e.content ?? e.message ?? "agent error") }
    else if (e.kind === "complete") yield { type: "complete", aborted: e.aborted === true }
    else if (e.type === "done") return
  }
}

/** URL of a session in the CloudCLI UI. */
export const cloudcliSessionUrl = (publicUrl: string, sessionId: string) =>
  `${publicUrl.replace(/\/$/, "")}/session/${encodeURIComponent(sessionId)}`
