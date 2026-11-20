import {
  type AppInfo,
  type ToolId,
  type ToolsSaveInput,
  ToolsSettings,
  type ToolsStatus,
} from "@workspace/contract"
import type { Db } from "@workspace/infra/db"
import type { SecretStore } from "@workspace/infra/secrets"
import { CLOUDCLI_PORT } from "@workspace/providers/cloudcli"
import { METAMCP_PORT } from "@workspace/providers/metamcp"
import { PLANE_PORT } from "@workspace/providers/plane"
import { ProviderState } from "./state"

export const TOOLS_ADMIN_PASSWORD_REF = "tools.admin"

/** Local port, tailnet HTTPS port and health path per tool. */
export const APPS: Record<
  ToolId,
  { name: string; description: string; local: number; tailnet: number; health: string }
> = {
  cloudcli: {
    name: "CloudCLI",
    description: "Start and manage Claude Code sessions",
    local: CLOUDCLI_PORT,
    tailnet: 8443,
    health: "/api/auth/status",
  },
  plane: {
    name: "Plane",
    description: "Scrum board and work items",
    local: PLANE_PORT,
    tailnet: 8444,
    health: "/api/instances/",
  },
  metamcp: {
    name: "MetaMCP",
    description: "Add MCP servers for Claude Code",
    local: METAMCP_PORT,
    tailnet: 8445,
    health: "/health",
  },
}

export class ToolsService {
  private readonly state: ProviderState

  constructor(
    db: Db,
    private readonly secrets: SecretStore,
    private readonly opts: {
      workspace: string
      tailnetHost: () => string | null
      fetch?: typeof fetch
    },
  ) {
    this.state = new ProviderState(db, opts.workspace, "tools")
  }

  getSettings(): ToolsSettings | null {
    const parsed = ToolsSettings.safeParse(this.state.get("settings"))
    return parsed.success ? parsed.data : null
  }

  adminPassword(): string | null {
    return !this.secrets.sealed && this.secrets.has(TOOLS_ADMIN_PASSWORD_REF)
      ? this.secrets.reveal(TOOLS_ADMIN_PASSWORD_REF)
      : null
  }

  /** Public (tailnet) URL of a tool, if the node's MagicDNS name is known. */
  appUrl(id: ToolId): string | null {
    const host = this.opts.tailnetHost()
    return host ? `https://${host}:${APPS[id].tailnet}` : null
  }

  async save(input: ToolsSaveInput): Promise<ToolsStatus> {
    if (input.adminPassword !== undefined) {
      await this.secrets.set(TOOLS_ADMIN_PASSWORD_REF, input.adminPassword, "password")
    } else if (!this.secrets.has(TOOLS_ADMIN_PASSWORD_REF)) {
      throw new Error("Set an admin password before saving the tool settings.")
    }
    this.state.set("settings", ToolsSettings.parse(input.settings))
    return this.status()
  }

  async status(): Promise<ToolsStatus> {
    const settings = this.getSettings()
    const adminPasswordSet = !this.secrets.sealed && this.secrets.has(TOOLS_ADMIN_PASSWORD_REF)
    const configured = Boolean(settings) && adminPasswordSet
    const apps = await Promise.all(
      (Object.keys(APPS) as ToolId[]).map(async (id): Promise<AppInfo> => {
        const app = APPS[id]
        let state: AppInfo["state"] = configured ? "pending_apply" : "not_configured"
        if (configured && (await this.probe(app.local, app.health))) state = "ready"
        return {
          id,
          name: app.name,
          description: app.description,
          url: this.appUrl(id),
          port: app.tailnet,
          state,
        }
      }),
    )
    return { settings, adminPasswordSet, configured, apps }
  }

  private async probe(port: number, path: string) {
    try {
      const res = await (this.opts.fetch ?? fetch)(`http://127.0.0.1:${port}${path}`, {
        signal: AbortSignal.timeout(1500),
        redirect: "manual",
      })
      return res.status < 500
    } catch {
      return false
    }
  }
}
