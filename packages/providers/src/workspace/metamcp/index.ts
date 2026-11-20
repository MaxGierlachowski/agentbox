import { Http, HttpError } from "../shared/http"

export const METAMCP_PORT = 12008
export const METAMCP_VERSION = "2.4.22"
export const METAMCP_NAMESPACE = "agentbox"
export const METAMCP_ENDPOINT = "claude"
export const METAMCP_SECRETS = {
  authSecret: "metamcp.auth_secret",
  dbPassword: "metamcp.db_password",
  apiKey: "metamcp.api_key",
} as const

/**
 * Caddy in front of MetaMCP for Claude Code. MetaMCP always serves the OAuth discovery
 * documents, and Claude Code >= 2.1.85 then starts an OAuth flow instead of using the bearer
 * token (metatool-ai/metamcp#277). Hiding /.well-known makes Claude Code use the header.
 */
export const MCP_GATEWAY_CADDYFILE = `{
\tadmin off
\tauto_https off
}

:80 {
\t@discovery path /.well-known/*
\trespond @discovery 404
\treverse_proxy metamcp:${METAMCP_PORT} {
\t\tflush_interval -1
\t}
}
`

export interface MetaMcpComposeOptions {
  workspace: string
  version?: string
  /** https://<node>.<tailnet>.ts.net:8445 – must match how the browser reaches the UI. */
  appUrl: string
  /** tmpfs env file with BETTER_AUTH_SECRET, DATABASE_URL, POSTGRES_PASSWORD. */
  secretEnvFile: string
  dbSecretEnvFile: string
  caddyfilePath: string
}

export function metamcpComposeServices(o: MetaMcpComposeOptions) {
  const labels = { "dev.agentbox.workspace": o.workspace, "dev.agentbox.provider": "metamcp" }
  return {
    metamcp: {
      image: `ghcr.io/metatool-ai/metamcp:${o.version ?? METAMCP_VERSION}`,
      restart: "unless-stopped",
      environment: {
        APP_URL: o.appUrl,
        NEXT_PUBLIC_APP_URL: o.appUrl,
        POSTGRES_HOST: "metamcp-db",
        POSTGRES_PORT: "5432",
        POSTGRES_USER: "metamcp",
        POSTGRES_DB: "metamcp",
        // Services in this Compose project are reached by name, never via the host.
        TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL: "false",
      },
      env_file: [o.secretEnvFile],
      ports: [`127.0.0.1:${METAMCP_PORT}:${METAMCP_PORT}`],
      depends_on: { "metamcp-db": { condition: "service_healthy" } },
      healthcheck: {
        test: ["CMD", "curl", "-fsS", `http://localhost:${METAMCP_PORT}/health`],
        interval: "10s",
        timeout: "5s",
        retries: 30,
        start_period: "60s",
      },
      labels,
    },
    "metamcp-db": {
      image: "postgres:16-alpine",
      restart: "unless-stopped",
      environment: { POSTGRES_USER: "metamcp", POSTGRES_DB: "metamcp" },
      env_file: [o.dbSecretEnvFile],
      volumes: ["metamcp-db:/var/lib/postgresql/data"],
      healthcheck: {
        test: ["CMD-SHELL", "pg_isready -U metamcp -d metamcp"],
        interval: "5s",
        timeout: "5s",
        retries: 20,
      },
      labels,
    },
    "mcp-gateway": {
      image: "caddy:2-alpine",
      restart: "unless-stopped",
      volumes: [`${o.caddyfilePath}:/etc/caddy/Caddyfile:ro`],
      depends_on: ["metamcp"],
      labels,
    },
  }
}

export function metamcpSecretEnv(s: { authSecret: string; dbPassword: string }) {
  return {
    BETTER_AUTH_SECRET: s.authSecret,
    POSTGRES_PASSWORD: s.dbPassword,
    DATABASE_URL: `postgresql://metamcp:${encodeURIComponent(s.dbPassword)}@metamcp-db:5432/metamcp`,
  }
}

/** MCP server entries agentbox creates in the namespace. Users add more in the MetaMCP UI. */
export interface StdioMcpServer {
  name: string
  description: string
  command: string
  args: string[]
  env: Record<string, string>
}

export function planeMcpServer(opts: {
  apiKey: string
  workspaceSlug: string
  baseUrl: string
  version?: string
}): StdioMcpServer {
  return {
    name: "plane",
    description: "Plane work items, comments, cycles (preconfigured by agentbox)",
    command: "uvx",
    args: [`plane-mcp-server@${opts.version ?? "0.3.4"}`, "stdio"],
    env: {
      PLANE_API_KEY: opts.apiKey,
      PLANE_WORKSPACE_SLUG: opts.workspaceSlug,
      PLANE_BASE_URL: opts.baseUrl,
    },
  }
}

/** Client for the tRPC API the MetaMCP UI itself uses (no transformer: raw JSON in and out). */
export class MetaMcpClient {
  readonly http: Http

  constructor(baseUrl: string, appUrl: string, fetchImpl?: typeof fetch) {
    // Better Auth trusts its own baseURL (APP_URL) as origin.
    this.http = new Http({ baseUrl, fetch: fetchImpl, headers: { origin: appUrl } })
  }

  async signUp(name: string, email: string, password: string) {
    return (
      await this.http.raw("POST", "/api/auth/sign-up/email", { body: { name, email, password } })
    ).ok
  }

  async signIn(email: string, password: string) {
    return (await this.http.raw("POST", "/api/auth/sign-in/email", { body: { email, password } }))
      .ok
  }

  async query<T>(proc: string): Promise<T> {
    return (await this.http.json<{ result: { data: T } }>("GET", `/trpc/frontend.${proc}`)).result
      .data
  }

  async mutate<T>(proc: string, input: unknown): Promise<T> {
    return (
      await this.http.json<{ result: { data: T } }>("POST", `/trpc/frontend.${proc}`, {
        body: input,
      })
    ).result.data
  }
}

type Named = { uuid: string; name: string }

export interface MetaMcpBootstrapResult {
  adminCreated: boolean
  namespaceUuid: string
  endpointCreated: boolean
  apiKey: string
  apiKeyCreated: boolean
  serversCreated: string[]
}

/**
 * Idempotent MetaMCP setup. Runs while MetaMCP is only reachable on loopback, so the admin
 * account is created before anyone else could sign up.
 */
export async function bootstrapMetaMcp(
  client: MetaMcpClient,
  opts: {
    admin: { name: string; email: string; password: string }
    existingApiKey?: string
    servers: StdioMcpServer[]
    log?: (line: string) => void
  },
): Promise<MetaMcpBootstrapResult> {
  const log = opts.log ?? (() => {})
  const { admin } = opts
  let adminCreated = false
  if (!(await client.signIn(admin.email, admin.password))) {
    if (
      !(await client.signUp(admin.name, admin.email, admin.password)) ||
      !(await client.signIn(admin.email, admin.password))
    ) {
      throw new Error(
        `MetaMCP: cannot create or sign in ${admin.email}; sign-up may already be closed for another admin`,
      )
    }
    adminCreated = true
    log(`created MetaMCP admin ${admin.email}`)
  }
  await client.mutate("config.setSignupDisabled", { disabled: true })

  const servers = (await client.query<{ data: Named[] }>("mcpServers.list")).data
  const serversCreated: string[] = []
  const serverUuids: string[] = []
  for (const s of opts.servers) {
    let existing = servers.find((x) => x.name === s.name)
    if (!existing) {
      const res = await client.mutate<{ data?: Named }>("mcpServers.create", {
        ...s,
        type: "STDIO",
      })
      if (!res.data) throw new Error(`MetaMCP: could not create MCP server ${s.name}`)
      existing = res.data
      serversCreated.push(s.name)
    }
    serverUuids.push(existing.uuid)
  }

  const namespaces = (
    await client.query<{ data: (Named & { servers?: { uuid: string }[] })[] }>("namespaces.list")
  ).data
  let ns = namespaces.find((n) => n.name === METAMCP_NAMESPACE)
  if (!ns) {
    const res = await client.mutate<{ data?: Named }>("namespaces.create", {
      name: METAMCP_NAMESPACE,
      description: "Tools for Claude Code in this workspace. Add MCP servers here.",
      mcpServerUuids: serverUuids,
    })
    if (!res.data) throw new Error("MetaMCP: could not create namespace")
    ns = res.data
    log(`created namespace ${METAMCP_NAMESPACE}`)
  } else if (serversCreated.length) {
    const current = (ns.servers ?? []).map((s) => s.uuid)
    await client.mutate("namespaces.update", {
      uuid: ns.uuid,
      name: ns.name,
      mcpServerUuids: [...new Set([...current, ...serverUuids])],
    })
  }

  const endpoints = (await client.query<{ data: Named[] }>("endpoints.list")).data
  let endpointCreated = false
  if (!endpoints.some((e) => e.name === METAMCP_ENDPOINT)) {
    await client.mutate("endpoints.create", {
      name: METAMCP_ENDPOINT,
      description: "Claude Code (CloudCLI) in this workspace",
      namespaceUuid: ns.uuid,
      enableApiKeyAuth: true,
      enableOauth: false,
      useQueryParamAuth: false,
      createMcpServer: false,
    })
    endpointCreated = true
    log(`created endpoint ${METAMCP_ENDPOINT}`)
  }

  let apiKey = opts.existingApiKey
  if (!apiKey) {
    const res = await client.mutate<{ key: string }>("apiKeys.create", { name: "claude-code" })
    if (!res.key?.startsWith("sk_mt_")) throw new Error("MetaMCP: unexpected API key response")
    apiKey = res.key
  }
  return {
    adminCreated,
    namespaceUuid: ns.uuid,
    endpointCreated,
    apiKey,
    apiKeyCreated: !opts.existingApiKey,
    serversCreated,
  }
}

/** True when a fresh sign-up is rejected. */
export async function metamcpSignUpClosed(
  baseUrl: string,
  appUrl: string,
  fetchImpl?: typeof fetch,
) {
  const probe = new MetaMcpClient(baseUrl, appUrl, fetchImpl)
  return !(await probe.signUp(
    "probe",
    `probe-${crypto.randomUUID()}@invalid.example`,
    crypto.randomUUID(),
  ))
}

export { HttpError }

// --- Claude Code configuration --------------------------------------------------------------

/** Endpoint URL as seen from the workspace container (through the gateway). */
export const metamcpEndpointUrl = (endpoint = METAMCP_ENDPOINT) =>
  `http://mcp-gateway/metamcp/${endpoint}/mcp`

/**
 * Merges agentbox's MCP entries into Claude Code's user config (~/.claude.json), leaving every
 * other key and any MCP server the user added untouched.
 */
export function mergeClaudeMcpConfig(
  existing: Record<string, unknown> | null,
  servers: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const base = existing ?? {}
  const current = (base.mcpServers as Record<string, unknown> | undefined) ?? {}
  return { ...base, mcpServers: { ...current, ...servers } }
}

export function claudeMcpServers(opts: { apiKey: string; browser: boolean }) {
  const servers: Record<string, Record<string, unknown>> = {
    metamcp: {
      type: "http",
      url: metamcpEndpointUrl(),
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    },
  }
  if (opts.browser) servers.browser = { type: "stdio", command: "agentbox-browser-mcp", args: [] }
  return servers
}
