import { type AutomationTask, PlaneAutomation, type TaskStore } from "@workspace/automation"
import {
  AutomationSettings,
  type AutomationStatus,
  type AutomationTask as TaskView,
} from "@workspace/contract"
import type { Db } from "@workspace/infra/db"
import { schema } from "@workspace/infra/db"
import type { SecretStore } from "@workspace/infra/secrets"
import { CLOUDCLI_PORT, CLOUDCLI_SECRETS, runAgent } from "@workspace/providers/cloudcli"
import { PLANE_PORT, PLANE_SECRETS, PlaneClient } from "@workspace/providers/plane"
import { and, desc, eq } from "drizzle-orm"
import { log } from "../log"
import type { ToolsService } from "../tools/service"
import { ProviderState } from "../tools/state"

class SqliteTaskStore implements TaskStore {
  constructor(
    private readonly db: Db,
    private readonly workspace: string,
  ) {}

  get(id: string): AutomationTask | null {
    const row = this.db
      .select()
      .from(schema.automationTasks)
      .where(eq(schema.automationTasks.id, id))
      .get()
    return row ? toTask(row) : null
  }

  save(t: AutomationTask) {
    const row = { ...t, workspace: this.workspace }
    this.db
      .insert(schema.automationTasks)
      .values(row)
      .onConflictDoUpdate({ target: schema.automationTasks.id, set: row })
      .run()
  }

  running(): AutomationTask[] {
    return this.db
      .select()
      .from(schema.automationTasks)
      .where(
        and(
          eq(schema.automationTasks.workspace, this.workspace),
          eq(schema.automationTasks.status, "running"),
        ),
      )
      .all()
      .map(toTask)
  }

  recent(limit: number): AutomationTask[] {
    return this.db
      .select()
      .from(schema.automationTasks)
      .where(eq(schema.automationTasks.workspace, this.workspace))
      .orderBy(desc(schema.automationTasks.startedAt))
      .limit(limit)
      .all()
      .map(toTask)
  }
}

function toTask(row: typeof schema.automationTasks.$inferSelect): AutomationTask {
  const { workspace: _ws, ...task } = row
  return task
}

/**
 * Runs the Plane -> CloudCLI automation inside the daemon. Active only when it is enabled, the
 * tools are configured, the secret store is unlocked and the API keys from the bootstrap exist.
 */
export class AutomationService {
  private readonly state: ProviderState
  private readonly store: SqliteTaskStore
  private automation: PlaneAutomation | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastPollAt: string | null = null
  private lastError: string | null = null
  private polling = false
  private recovered = false

  constructor(
    db: Db,
    private readonly secrets: SecretStore,
    private readonly tools: ToolsService,
    opts: { workspace: string },
  ) {
    this.state = new ProviderState(db, opts.workspace, "automation")
    this.store = new SqliteTaskStore(db, opts.workspace)
  }

  settings(): AutomationSettings {
    const parsed = AutomationSettings.safeParse(this.state.get("settings") ?? {})
    return parsed.success ? parsed.data : AutomationSettings.parse({})
  }

  save(settings: AutomationSettings): AutomationStatus {
    this.state.set("settings", AutomationSettings.parse(settings))
    this.automation?.setConfig(this.config())
    this.reschedule(0)
    return this.status()
  }

  /** Why the automation cannot run right now, or null. */
  blockedBy(): string | null {
    const s = this.settings()
    if (!s.enabled) return "Automation is switched off."
    if (s.projects.length === 0) return "Map at least one Plane project to a repository."
    if (this.secrets.sealed) return "agentbox is locked."
    const tools = this.tools.getSettings()
    if (!tools) return "Configure the tools first."
    if (!this.secrets.has(PLANE_SECRETS.apiToken) || !this.secrets.has(CLOUDCLI_SECRETS.apiKey)) {
      return "Waiting for the first apply to create the Plane and CloudCLI API keys."
    }
    return null
  }

  status(): AutomationStatus {
    const blockedBy = this.blockedBy()
    return {
      settings: this.settings(),
      active: blockedBy === null,
      blockedBy,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      tasks: this.store.recent(100).map((t) => this.view(t)),
    }
  }

  start() {
    this.reschedule(5_000)
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async pollNow(): Promise<AutomationStatus> {
    await this.tick()
    return this.status()
  }

  private reschedule(delayMs = this.settings().pollSeconds * 1000) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.reschedule())
    }, delayMs)
  }

  private async tick() {
    if (this.polling || this.blockedBy()) return
    this.polling = true
    try {
      const automation = this.ensureAutomation()
      if (!this.recovered) {
        await automation.recoverInterrupted()
        this.recovered = true
      }
      const started = await automation.poll()
      if (started.length) log.info({ started }, "automation started work items")
      this.lastError = null
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      log.warn({ err: this.lastError }, "automation poll failed")
    } finally {
      this.lastPollAt = new Date().toISOString()
      this.polling = false
    }
  }

  private config() {
    const s = this.settings()
    return {
      label: s.label,
      stateGroups: s.stateGroups,
      maxParallel: s.maxParallel,
      timeoutMinutes: s.timeoutMinutes,
      projects: s.projects,
    }
  }

  private ensureAutomation() {
    if (this.automation) return this.automation
    const tools = this.tools.getSettings()
    if (!tools) throw new Error("tools not configured")
    const plane = new PlaneClient(
      `http://127.0.0.1:${PLANE_PORT}`,
      this.secrets.reveal(PLANE_SECRETS.apiToken),
      tools.plane.workspace.slug,
    )
    const apiKey = () => this.secrets.reveal(CLOUDCLI_SECRETS.apiKey)
    this.automation = new PlaneAutomation(
      {
        plane,
        runAgent: (req, signal) =>
          runAgent({ baseUrl: `http://127.0.0.1:${CLOUDCLI_PORT}`, apiKey: apiKey(), signal }, req),
        store: this.store,
        urls: {
          planeWeb: this.tools.appUrl("plane") ?? `http://127.0.0.1:${PLANE_PORT}`,
          cloudcli: this.tools.appUrl("cloudcli") ?? `http://127.0.0.1:${CLOUDCLI_PORT}`,
        },
        repoPath: (repo) => `/workspaces/${repo}`,
        log: (msg, extra) => log.info(extra ?? {}, msg),
      },
      this.config(),
    )
    return this.automation
  }

  private view(t: AutomationTask): TaskView {
    const cloudcli = this.tools.appUrl("cloudcli")
    const plane = this.tools.appUrl("plane")
    const slug = this.tools.getSettings()?.plane.workspace.slug
    return {
      id: t.id,
      key: t.key,
      title: t.title,
      repo: t.repo,
      status: t.status,
      attempt: t.attempt,
      sessionUrl:
        cloudcli && t.sessionId ? `${cloudcli}/session/${encodeURIComponent(t.sessionId)}` : null,
      issueUrl: plane && slug ? `${plane}/${slug}/projects/${t.projectId}/issues/${t.id}` : null,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      error: t.error,
    }
  }
}
